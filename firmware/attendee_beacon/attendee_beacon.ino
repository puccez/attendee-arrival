/*
 * attendee_beacon — il beacon-notaio fisico del venue (ESP32).
 *
 * Emette un frame iBeacon con UUID FISSO (l'identità su cui iOS sveglia
 * l'app: non può ruotare) e il Codice Rotante dell'evento nei campi
 * major/minor, riderivato a ogni finestra di 30 s dal seme dell'evento.
 *
 *   major = le prime 2 cifre del codice   |  codice = major*10000 + minor
 *   minor = le ultime 4 cifre             |  (leggibile a occhio in nRF Connect)
 *
 * Il notaio certifica tempo e luogo senza vedere nessuno: non si connette a
 * niente e non riceve niente. La direzione è telefono-ascolta, non
 * beacon-guarda (vedi CONTEXT.md).
 *
 * LIMITE DICHIARATO — l'orologio: l'ESP32 non ha RTC a batteria. A ogni
 * power-cycle l'ora riparte da zero e i codici derivati sarebbero respinti
 * dal server. Perciò all'avvio si sincronizza via NTP (WiFi) oppure si
 * riceve l'ora via seriale (`time <epoch_ms>`). Finché l'ora non è valida il
 * beacon annuncia comunque l'UUID — così il risveglio dell'app funziona —
 * ma con major=0 minor=0, che significa "orologio non sincronizzato".
 * È anche il motivo per cui il default di prodotto resta il telefono
 * dell'host: ha già l'ora giusta e la rete.
 *
 * Toolchain: PlatformIO (firmware/platformio.ini) o Arduino IDE/CLI.
 * Dipendenza: NimBLE-Arduino 2.x. Istruzioni in firmware/README.md.
 */

#include <HTTPClient.h>
#include <NimBLEDevice.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <sys/time.h>
#include <time.h>

#include "config.h"
#include "ibeacon_frame.h"
#include "rotating_code.h"

static Preferences prefs;
static NimBLEAdvertising *advertising = nullptr;

static String seedHex = BEACON_DEFAULT_SEED;
static String uuidText = BEACON_DEFAULT_UUID;
static String wifiSsid = BEACON_DEFAULT_WIFI_SSID;
static String wifiPassword = BEACON_DEFAULT_WIFI_PASSWORD;
static String apiBase = BEACON_DEFAULT_API_BASE;
static String assignedEvent = "";
/* Il seme messo a mano da seriale è sovrano: un «libero» dal server non lo
 * tocca. Solo ciò che il server ha dato, il server può riprendersi. */
static bool seedFromServer = false;

static uint8_t proximityUuid[16];
static int64_t lastWindow = INT64_MIN;
static bool clockSynced = false;
static bool advertisingSilenced = false;

/* Il seme di fabbrica è un segnaposto, non un incarico: senza un seme vero
 * il beacon TACE — un UUID in onda senza evento sveglierebbe app a caso. */
static bool hasSeed() {
  return seedHex.length() >= 16 && seedHex != BEACON_DEFAULT_SEED;
}

/* ------------------------------------------------------------- orologio */

static int64_t nowEpochMs() {
  struct timeval tv;
  gettimeofday(&tv, nullptr);
  return (int64_t)tv.tv_sec * 1000 + (int64_t)tv.tv_usec / 1000;
}

/* Un'ora plausibile è già dopo il 2024: distingue NTP fatto da orologio a zero. */
static bool clockLooksValid() { return nowEpochMs() > 1700000000000LL; }

static void setClockFromEpochMs(int64_t epochMs) {
  struct timeval tv;
  tv.tv_sec = (time_t)(epochMs / 1000);
  tv.tv_usec = (suseconds_t)((epochMs % 1000) * 1000);
  settimeofday(&tv, nullptr);
}

/* --------------------------------------------------------------- UUID */

/* "B6C60396-4B64-..." → 16 byte big-endian. false se la stringa non è un UUID. */
static bool parseUuid(const String &text, uint8_t out[16]) {
  size_t written = 0;
  int high = -1;
  for (size_t i = 0; i < text.length(); i++) {
    char c = text[i];
    if (c == '-') continue;
    int nibble;
    if (c >= '0' && c <= '9') nibble = c - '0';
    else if (c >= 'a' && c <= 'f') nibble = c - 'a' + 10;
    else if (c >= 'A' && c <= 'F') nibble = c - 'A' + 10;
    else return false;
    if (high < 0) {
      high = nibble;
    } else {
      if (written >= 16) return false;
      out[written++] = (uint8_t)((high << 4) | nibble);
      high = -1;
    }
  }
  return written == 16 && high < 0;
}

/* ---------------------------------------------------------- advertising */

/* La forma dei byte in onda sta in ibeacon_frame.c: è un contratto fra
 * firmware, app attendee e test di parità, non un dettaglio dello sketch. */
static void advertiseCode(uint16_t major, uint16_t minor) {
  uint8_t manufacturer[IBEACON_MANUFACTURER_LEN];
  ibeacon_build_manufacturer_data(proximityUuid, major, minor,
                                  (int8_t)BEACON_MEASURED_POWER, manufacturer);

  NimBLEAdvertisementData data;
  /* 0x02 LE General Discoverable | 0x04 BR/EDR non supportato. */
  data.setFlags(0x06);
  data.setManufacturerData(manufacturer, IBEACON_MANUFACTURER_LEN);

  /* Il payload iBeacon riempie i 31 byte: il nome non ci sta. Va nella
   * scan response, altrimenti uno scanner mostra un dispositivo anonimo
   * (il beacon è non-connettibile, quindi il nome GAP non è leggibile).
   * Serve solo agli umani che verificano — l'app usa UUID e major/minor. */
  NimBLEAdvertisementData scanResponse;
  scanResponse.setName(BEACON_NAME);

  advertising->stop();
  advertising->setAdvertisementData(data);
  advertising->setScanResponseData(scanResponse);
  advertising->enableScanResponse(true);
  advertising->start();
}

/* Riemette subito, senza aspettare il cambio di finestra. */
static void refreshAdvertising(bool force) {
  if (!hasSeed()) {
    if (force || !advertisingSilenced) {
      advertisingSilenced = true;
      lastWindow = INT64_MIN;
      clockSynced = false;
      advertising->stop();
      Serial.println("[beacon] senza incarico il beacon tace — assegnalo dal "
                     "web o con `seed <hex>`");
    }
    return;
  }
  if (advertisingSilenced) {
    advertisingSilenced = false;
    force = true;
  }

  if (!clockLooksValid()) {
    if (force || clockSynced) {
      clockSynced = false;
      lastWindow = INT64_MIN;
      advertiseCode(0, 0);
      Serial.println("[beacon] orologio non sincronizzato → major=0 minor=0 "
                     "(l'UUID continua a svegliare l'app)");
    }
    return;
  }

  int64_t epochMs = nowEpochMs();
  int64_t window = rotating_window_index(epochMs);
  if (!force && window == lastWindow && clockSynced) return;

  clockSynced = true;
  lastWindow = window;

  char code[ROTATING_CODE_DIGITS + 1];
  rotating_code_string(seedHex.c_str(), epochMs, code);
  uint16_t major = 0, minor = 0;
  rotating_code_split(rotating_code_value(seedHex.c_str(), epochMs), &major,
                      &minor);
  advertiseCode(major, minor);

  Serial.printf("[beacon] finestra %lld → codice %s (major=%u minor=%u)\n",
                (long long)window, code, (unsigned)major, (unsigned)minor);
}

/* --------------------------------------------------------- provisioning */

static void loadSettings() {
  prefs.begin("wemeet", false);
  seedHex = prefs.getString("seed", BEACON_DEFAULT_SEED);
  uuidText = prefs.getString("uuid", BEACON_DEFAULT_UUID);
  wifiSsid = prefs.getString("ssid", BEACON_DEFAULT_WIFI_SSID);
  wifiPassword = prefs.getString("pass", BEACON_DEFAULT_WIFI_PASSWORD);
  apiBase = prefs.getString("api", BEACON_DEFAULT_API_BASE);
  assignedEvent = prefs.getString("event", "");
  seedFromServer = prefs.getBool("srvseed", false);

  if (!parseUuid(uuidText, proximityUuid)) {
    Serial.println("[beacon] UUID non valido, torno al default");
    uuidText = BEACON_DEFAULT_UUID;
    parseUuid(uuidText, proximityUuid);
  }
}

static void connectWifiAndSyncClock() {
  if (wifiSsid.length() == 0) {
    Serial.println("[beacon] nessuna rete configurata — usa `wifi <ssid> "
                   "<password>` oppure `time <epoch_ms>`");
    return;
  }

  Serial.printf("[beacon] WiFi \"%s\"…\n", wifiSsid.c_str());
  WiFi.mode(WIFI_STA);
  WiFi.begin(wifiSsid.c_str(), wifiPassword.c_str());
  uint32_t deadline = millis() + 20000;
  while (WiFi.status() != WL_CONNECTED && millis() < deadline) {
    delay(250);
  }
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[beacon] WiFi non connesso: l'ora resta da impostare");
    return;
  }

  Serial.printf("[beacon] WiFi ok (%s), sincronizzo NTP…\n",
                WiFi.localIP().toString().c_str());
  configTime(0, 0, "pool.ntp.org", "time.google.com"); /* UTC: nessun fuso */
  deadline = millis() + 15000;
  while (!clockLooksValid() && millis() < deadline) {
    delay(250);
  }
  Serial.println(clockLooksValid() ? "[beacon] ora sincronizzata"
                                   : "[beacon] NTP non ha risposto");
}

/* ------------------------------------------------------------- battito */

/* "AA:BB:CC:DD:EE:FF" → "esp32-ddeeff": corto, stabile, senza segreti. */
static String deviceIdText() {
  String mac = WiFi.macAddress();
  mac.replace(":", "");
  mac.toLowerCase();
  return "esp32-" + mac.substring(6);
}

static uint32_t lastHeartbeatAt = 0;
static bool heartbeatEverDone = false;
static String heartbeatNote = "mai battuto";

/*
 * Il battito: «sono vivo, emetto questo» — e la risposta è l'incarico.
 * Due parole per riga (`evento <id>` + `seme <hex>`, oppure `libero`):
 * il server parla il dialetto del microcontrollore, non viceversa.
 *
 * TLS senza verifica del certificato: su questa scheda il pinning della CA
 * è il pezzo di produzione che manca, e va detto — un MITM attivo sulla
 * rete del venue potrebbe leggere il seme in transito. Stesso livello di
 * fiducia del resto delle porte demo (business case, sezione 9.2).
 */
static void heartbeat() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  http.setTimeout(4000);
  String url = apiBase + "/notary-devices/" + deviceIdText() + "/heartbeat";
  WiFiClientSecure secure;
  WiFiClient plain;
  bool began;
  if (url.startsWith("https://")) {
    secure.setInsecure();
    began = http.begin(secure, url);
  } else {
    began = http.begin(plain, url);
  }
  if (!began) {
    heartbeatNote = "URL non valido";
    return;
  }

  http.addHeader("Content-Type", "application/json");
  String body = "{\"clockSynced\":";
  body += clockLooksValid() ? "true" : "false";
  if (clockLooksValid() && hasSeed()) {
    char code[ROTATING_CODE_DIGITS + 1];
    rotating_code_string(seedHex.c_str(), nowEpochMs(), code);
    body += ",\"code\":\"";
    body += code;
    body += "\"";
  }
  body += "}";

  int status = http.POST(body);
  if (status < 200 || status >= 300) {
    heartbeatNote = "HTTP " + String(status);
    http.end();
    return;
  }
  String reply = http.getString();
  http.end();

  if (reply.startsWith("evento ")) {
    int eol = reply.indexOf('\n');
    String eventId = reply.substring(7, eol < 0 ? (int)reply.length() : eol);
    eventId.trim();
    String newSeed = "";
    int at = reply.indexOf("seme ");
    if (at >= 0) {
      int end = reply.indexOf('\n', at);
      newSeed = reply.substring(at + 5, end < 0 ? (int)reply.length() : end);
      newSeed.trim();
    }
    if (newSeed.length() >= 16 &&
        (newSeed != seedHex || eventId != assignedEvent)) {
      seedHex = newSeed;
      assignedEvent = eventId;
      seedFromServer = true;
      prefs.putString("seed", seedHex);
      prefs.putString("event", assignedEvent);
      prefs.putBool("srvseed", true);
      Serial.printf("[beacon] incarico ricevuto: evento %s\n", eventId.c_str());
      refreshAdvertising(true);
    }
    heartbeatNote = "incaricato";
  } else if (reply.startsWith("libero")) {
    if (hasSeed() && seedFromServer) {
      /* L'igiene del seme vale anche per l'hardware: revocato = dimenticato. */
      seedHex = BEACON_DEFAULT_SEED;
      assignedEvent = "";
      seedFromServer = false;
      prefs.putString("seed", seedHex);
      prefs.putString("event", "");
      prefs.putBool("srvseed", false);
      Serial.println("[beacon] incarico revocato: seme dimenticato");
      refreshAdvertising(true);
    }
    heartbeatNote = hasSeed() ? "libero (seme da seriale: lo tengo)" : "libero";
  } else {
    heartbeatNote = "risposta illeggibile";
  }
}

static void heartbeatIfDue() {
  if (heartbeatEverDone &&
      millis() - lastHeartbeatAt < BEACON_HEARTBEAT_INTERVAL_MS) {
    return;
  }
  lastHeartbeatAt = millis();
  heartbeatEverDone = true;
  heartbeat();
}

static void printStatus() {
  char code[ROTATING_CODE_DIGITS + 1] = "------";
  if (clockLooksValid()) rotating_code_string(seedHex.c_str(), nowEpochMs(), code);
  time_t seconds = (time_t)(nowEpochMs() / 1000);
  struct tm utc;
  gmtime_r(&seconds, &utc);
  char stamp[32];
  strftime(stamp, sizeof stamp, "%Y-%m-%dT%H:%M:%SZ", &utc);

  Serial.println("--- beacon-notaio ---");
  Serial.printf("  device    %s\n", deviceIdText().c_str());
  Serial.printf("  uuid      %s\n", uuidText.c_str());
  if (hasSeed()) {
    Serial.printf("  seme      %s…%s (%u char, %s)\n",
                  seedHex.substring(0, 8).c_str(),
                  seedHex.substring(seedHex.length() - 4).c_str(),
                  (unsigned)seedHex.length(),
                  seedFromServer ? "dal server" : "da seriale");
  } else {
    Serial.println("  seme      nessuno: il beacon tace");
  }
  Serial.printf("  incarico  %s\n", assignedEvent.length() > 0
                                        ? assignedEvent.c_str()
                                        : "libero");
  Serial.printf("  ora       %s (%s)\n", stamp,
                clockLooksValid() ? "sincronizzata" : "NON sincronizzata");
  Serial.printf("  wifi      %s\n", WiFi.status() == WL_CONNECTED
                                        ? WiFi.SSID().c_str()
                                        : "non connesso");
  Serial.printf("  api       %s\n", apiBase.c_str());
  Serial.printf("  battito   %s\n", heartbeatNote.c_str());
  Serial.printf("  codice    %s\n", hasSeed() ? code : "------");
  Serial.println("---------------------");
}

static void handleCommand(String line) {
  line.trim();
  if (line.length() == 0) return;

  int space = line.indexOf(' ');
  String verb = space < 0 ? line : line.substring(0, space);
  String rest = space < 0 ? "" : line.substring(space + 1);
  rest.trim();

  if (verb == "seed") {
    if (rest.length() < 16) {
      Serial.println("[beacon] seme troppo corto (atteso l'hex di POST /events)");
      return;
    }
    seedHex = rest;
    seedFromServer = false; /* la mano dell'operatore vince sul server */
    prefs.putString("seed", seedHex);
    prefs.putBool("srvseed", false);
    Serial.println("[beacon] seme aggiornato (da seriale: un «libero» del "
                   "server non lo tocca)");
    refreshAdvertising(true);
  } else if (verb == "uuid") {
    uint8_t parsed[16];
    if (!parseUuid(rest, parsed)) {
      Serial.println("[beacon] UUID non valido");
      return;
    }
    memcpy(proximityUuid, parsed, 16);
    uuidText = rest;
    prefs.putString("uuid", uuidText);
    Serial.println("[beacon] UUID aggiornato (ricordati di allinearlo nell'app)");
    refreshAdvertising(true);
  } else if (verb == "wifi") {
    int sep = rest.indexOf(' ');
    wifiSsid = sep < 0 ? rest : rest.substring(0, sep);
    wifiPassword = sep < 0 ? "" : rest.substring(sep + 1);
    prefs.putString("ssid", wifiSsid);
    prefs.putString("pass", wifiPassword);
    Serial.println("[beacon] rete salvata, mi riconnetto");
    connectWifiAndSyncClock();
    refreshAdvertising(true);
  } else if (verb == "time") {
    int64_t epochMs = (int64_t)atoll(rest.c_str());
    if (epochMs < 1700000000000LL) {
      Serial.println("[beacon] servono i millisecondi da epoch UTC "
                     "(node -e 'console.log(Date.now())')");
      return;
    }
    setClockFromEpochMs(epochMs);
    Serial.println("[beacon] orologio impostato a mano");
    refreshAdvertising(true);
  } else if (verb == "api") {
    if (!rest.startsWith("http")) {
      Serial.println("[beacon] serve un URL http(s)://…");
      return;
    }
    while (rest.endsWith("/")) rest.remove(rest.length() - 1);
    apiBase = rest;
    prefs.putString("api", apiBase);
    heartbeatEverDone = false; /* battito subito sul nuovo indirizzo */
    Serial.printf("[beacon] api → %s\n", apiBase.c_str());
  } else if (verb == "status") {
    printStatus();
  } else if (verb == "reset") {
    prefs.clear();
    Serial.println("[beacon] NVS pulita, riavvio");
    delay(200);
    ESP.restart();
  } else {
    Serial.println("comandi: seed <hex> | uuid <uuid> | wifi <ssid> <pass> | "
                   "api <url> | time <epoch_ms> | status | reset");
  }
}

/* ---------------------------------------------------------------- setup */

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println();
  Serial.println("[beacon] beacon-notaio WeMeet");

  loadSettings();
  connectWifiAndSyncClock();

  NimBLEDevice::init(BEACON_NAME);
  NimBLEDevice::setPower(3); /* dBm */
  advertising = NimBLEDevice::getAdvertising();
  advertising->setMinInterval(BEACON_ADV_INTERVAL);
  advertising->setMaxInterval(BEACON_ADV_INTERVAL);
  /* Non connettibile: il notaio non riceve niente da nessuno. */
  advertising->setConnectableMode(BLE_GAP_CONN_MODE_NON);

  refreshAdvertising(true);
  printStatus();
  Serial.println("[beacon] scrivi `status` per lo stato, `help` per i comandi");
}

void loop() {
  static String pending;
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (pending.length() > 0) {
        handleCommand(pending);
        pending = "";
      }
    } else if (pending.length() < 200) {
      pending += c;
    }
  }

  heartbeatIfDue();
  refreshAdvertising(false);
  delay(200);
}
