# firmware — il beacon-notaio del venue (ESP32)

Un ESP32 che emette il **Codice Rotante** dell'evento come frame **iBeacon**.
È il canale radio del sistema: il telefono lo sente da solo, indoor, in
tasca. Il notaio certifica tempo e luogo senza vedere nessuno — non si
connette a niente, non riceve niente, non sa chi c'è (vedi `CONTEXT.md`).

## Il frame

```
4C 00        company id Apple (little-endian)
02 15        tipo iBeacon + lunghezza del payload (21)
16 byte      UUID di prossimità  ← identità FISSA
2 byte       major (big-endian)  ← prime 2 cifre del codice
2 byte       minor (big-endian)  ← ultime 4 cifre del codice
1 byte       potenza calibrata a 1 m (-59 dBm)
```

- **UUID fisso** `B6C60396-4B64-44D6-84E7-54909270550C` — è l'identità su cui
  iOS registra la region e sveglia l'app in background: **non può ruotare**.
  Lo stesso valore è cablato nell'app attendee (`apps/mobile`).
- **Il segreto che ruota sta in major/minor**: `codice = major × 10000 + minor`.
  La divisione è decimale apposta: uno scanner BLE generico mostra
  `major 12 / minor 3456` e tu leggi **123456** senza convertire niente.
- L'`eventId` **non** è nel frame: l'app lo conosce dalla registrazione
  dell'attendee (come da `docs/spec.md`, l'intent di check-in include
  l'evento). L'UUID dice solo "questo è un beacon WeMeet".

## Verificarlo senza l'app

1. Apri **nRF Connect** (o LightBlue) sul telefono e cerca `wemeet-notaio`.
2. Leggi `major`/`minor` e ricomponi il codice.
3. Confrontalo con `GET /events/:id/code` dell'API
   (`https://attendee-arrival-api.vercel.app/events/<id>/code`) — o con la
   console host, che mostra lo stesso codice come QR.

Se coincidono, il canale radio e il canale ottico stanno emettendo **lo
stesso codice**: è il punto del modello.

## Compilare e flashare

Serve un ESP32 con Bluetooth (qualunque `esp32dev`, WROOM/WROVER).
Dipendenza unica: **NimBLE-Arduino 2.x**. La derivazione del codice è in C
puro senza dipendenze (`rotating_code.c`): niente mbedTLS, così compila
identica su ESP32 e su host per i test.

### PlatformIO (consigliata: installa tutto da sé)

```bash
python3 -m venv ~/.platformio-venv                 # una volta
~/.platformio-venv/bin/pip install platformio      # (su Arch/Debian recenti
export PATH="$HOME/.platformio-venv/bin:$PATH"     #  pip non installa
cd firmware                                        #  fuori da un venv)
pio run -t upload -t monitor
```

**Verificato**: il firmware compila pulito, zero warning, con
`espressif32 7.0.1` + `NimBLE-Arduino 2.5.1` (versioni pinnate in
`platformio.ini`). Occupazione: **RAM 17,1%**, **flash 32,5%** con lo
schema di partizioni `huge_app` — niente OTA, tutto lo spazio
all'applicazione.

### Arduino IDE / arduino-cli

Apri `firmware/attendee_beacon/attendee_beacon.ino` (la cartella e lo sketch
devono avere lo stesso nome: già così). Serve il core `esp32` di Espressif e
la libreria NimBLE-Arduino.

```bash
arduino-cli core install esp32:esp32
arduino-cli lib install NimBLE-Arduino
arduino-cli compile -b esp32:esp32:esp32 firmware/attendee_beacon
arduino-cli upload -b esp32:esp32:esp32 -p /dev/ttyUSB0 firmware/attendee_beacon
arduino-cli monitor -p /dev/ttyUSB0 -c baudrate=115200
```

## Incarico via web (la strada comoda)

Con una rete WiFi configurata il beacon **batte** verso l'API ogni 20 s
(`POST /notary-devices/:id/heartbeat`, id derivato dal MAC: `esp32-570cc8`)
e la risposta è il suo incarico: evento + seme, oppure `libero`. Dalla home
web si vede il beacon («connesso adesso» = battito recente), gli si assegna
un evento e glielo si revoca: al battito successivo la scheda scarica il
seme — o lo dimentica. **Senza incarico il beacon tace**: niente
advertising, perché un UUID in onda senza evento sveglierebbe app a caso.

Il verso è pull di necessità (la scheda sta dietro NAT), la risposta è testo
semplice (`evento <id>` + `seme <hex>`) perché il parser sul
microcontrollore deve stare in dieci righe. TLS senza verifica del
certificato: limite dichiarato nello sketch, il pinning della CA è il pezzo
di produzione che manca.

## Provisioning via seriale (senza rete, o senza web)

Il monitor seriale (115200 baud) resta la strada sovrana: un seme messo con
`seed` **non** viene toccato da un `libero` del server — solo ciò che il
server ha dato, il server può riprendersi.

```
seed <hex>              il seme restituito da POST /events (64 char)
uuid <uuid>             cambia l'UUID di prossimità (allinea anche l'app!)
wifi <ssid> <password>  rete per NTP e battito
api <url>               l'API del battito (default: produzione; utile in dev)
time <epoch_ms>         imposta l'ora a mano (venue senza WiFi)
status                  stato: device id, incarico, ora, battito, codice
reset                   pulisce la NVS e riavvia
```

Sequenza tipica prima di una demo:

```bash
# 1. crea l'evento e prendi il seme
curl -s -X POST https://attendee-arrival-api.vercel.app/events \
  -H 'content-type: application/json' \
  -d '{"name":"WeMeet demo","startsAt":"2026-08-04T18:00:00Z","endsAt":"2026-08-04T23:00:00Z"}'

# 2. sul monitor seriale
wifi CasaWifi lapassword
seed 9f3c…                 # il seed della risposta
status                     # controlla che l'ora sia sincronizzata
```

Senza WiFi al venue: `time 1786000000000` (prendi il valore da
`node -e 'console.log(Date.now())'` sul laptop).

## Il limite dell'orologio, dichiarato

L'ESP32 **non ha un RTC a batteria**: a ogni power-cycle l'ora riparte da
zero e i codici derivati verrebbero respinti dal server. Perciò all'avvio si
sincronizza via NTP, o riceve l'ora via seriale.

Finché l'ora non è valida il beacon **annuncia comunque l'UUID** — così il
risveglio dell'app in prossimità continua a funzionare — ma con
`major=0 minor=0`, che significa "orologio non sincronizzato". Fallisce
rumorosamente invece di emettere in silenzio codici che nessuno accrediterà.

È anche il motivo per cui il default di prodotto resta il **telefono
dell'host**: ha già l'ora giusta e la rete. Il beacon fisso è
l'ottimizzazione per i venue ricorrenti.

## Test (senza hardware)

```bash
make -C firmware test
```

Compila `rotating_code.c` con gcc e confronta 500 coppie casuali
(seme × istante) con `deriveRotatingCode()` di `@attendee-arrival/core` —
la stessa funzione con cui il server verifica. Copre anche i confini di
finestra e il contratto `major*10000+minor`.

Un bit di scarto fra le due implementazioni e il beacon emetterebbe codici
che il server respinge: è l'unico modo di accorgersene prima di essere al
venue con l'hardware in mano.

## File

| file | cosa fa |
| --- | --- |
| `attendee_beacon/attendee_beacon.ino` | setup BLE, orologio, provisioning seriale, riemissione a ogni finestra |
| `attendee_beacon/rotating_code.{c,h}` | Codice Rotante in C puro — gemello di `packages/core/src/rotating-code.ts` |
| `attendee_beacon/config.h` | default di fabbrica (UUID, seme, WiFi) |
| `test/parity_main.c` | oracolo host: stdin `<seme> <ms>` → `<codice> <major> <minor>` |
| `test/parity.test.mjs` | il confronto firmware ↔ core |
