# Handoff — Traccia B: app nativa (Expo + BLE) e beacon ESP32

> Dossier di contesto per chi lavora al canale radio. Leggi anche
> `CONTEXT.md` (glossario) e `docs/spec.md` (spec tecnica). Non modificare
> `docs/spec.md`, `docs/business-case*` né `apps/web/`: sono della traccia A.
> Il tuo perimetro è `apps/mobile/` e `firmware/`.

## Il compito

Il canale radio del sistema, per davvero: un ESP32 che emette il Codice
Rotante come iBeacon, e un'app Expo che si sveglia quando entri nel raggio,
cattura i codici senza gesti dell'utente e li consegna alla stessa API della
demo web. Serve per il video della consegna e per la demo dal vivo: è la
prova che il BLE non è slideware.

## Il modello (già deciso, non ridiscuterlo)

Un **beacon-notaio** al venue emette un **Codice Rotante**: segreto effimero
(finestra 30 s) derivato da un seme per-evento. Chi lo consegna dimostra di
essere stato lì in quel minuto. Un solo codice, due canali: radio (BLE) e
ottico (QR). Il GPS non è mai una prova: sveglia l'app e innesca la notifica.

Ogni check-in è etichettato su due assi: **provenienza** (macchina/umano/
nessuno) × **qualità** (quanti codici, arco temporale = dwell, tap).

Glossario completo in `CONTEXT.md`. Tesi: *la posizione si dichiara, la
prossimità si dimostra, la permanenza si conferma*.

## Cosa esiste già e va riusato, non riscritto

- **`packages/core`** (`@attendee-arrival/core`) — la derivazione del codice
  è qui: `deriveRotatingCode(seed, at)` → 6 cifre, HMAC-SHA256 con
  troncatura stile RFC 4226. È volutamente compatta per stare nei campi
  **major/minor** di un frame iBeacon (2 + 2 byte). Stessa funzione per
  emissione e verifica.
- **`apps/api`** (NestJS, live su https://attendee-arrival-api.vercel.app):
  - `POST /events` → crea evento, restituisce `{id, seed, ...}` (il seme
    serve al beacon);
  - `GET /events/:id` → evento senza seme;
  - `GET /events/:id/code` → codice corrente (utile per debug e per la
    console);
  - `POST /events/:id/deliveries` → **la cucitura**: `{deviceId,
    attendeeName?, codes:[{value, collectedAt}], gps?, hostAttested?,
    confirmationTap?}` → check-in etichettato. È l'unico modo di scrivere;
  - `POST /powersync-token` → `{deviceId}` → `{token, endpoint}` per il
    sync del borsellino;
  - `GET /events/:id/check-ins` → dashboard host.
- **`apps/web`** — la demo web completa (console, attendee, sandbox
  d'attacco). Guarda `apps/web/app/powersync/connector.ts`: la logica di
  `uploadData` che raggruppa il borsellino in consegne è già scritta e va
  replicata nell'app RN.
- **PowerSync Cloud** già configurato (istanza `attendee-arrival`, EU) con
  sync stream `my_check_ins` filtrato per `device_id = auth.user_id()`.
  Schema client in `apps/web/app/powersync/AppSchema.ts` — riusalo.

## Da costruire

### 1. Firmware ESP32 (`firmware/`)

- Advertising **iBeacon** con **UUID fisso** (è l'identità su cui iOS
  sveglia l'app: non può ruotare) e **codice rotante nei campi
  major/minor**, derivato dal seme dell'evento con lo stesso algoritmo del
  core.
- Il seme si provisiona una volta (hardcoded per la demo va bene, ma
  dichiaralo; meglio se via seriale/WiFi).
- **Attenzione all'orologio**: l'ESP32 non ha RTC a batteria. Un
  power-cycle azzera l'ora e i codici diventano invalidi. Per la demo:
  sincronizza via NTP all'avvio (WiFi) e dichiara il limite. È anche il
  motivo per cui il default di prodotto è il telefono dell'host.
- Toolchain a tua scelta (ESP-IDF o Arduino); documenta come si flasha in
  `firmware/README.md`.

### 2. App attendee Expo (`apps/mobile/`)

Stack confermato da WeRoad: React Native + Expo, TypeScript. Serve una
**dev build** (non Expo Go: il BLE richiede moduli nativi).

- **Wake in background**: iBeacon region monitoring (iOS) e scanning via
  PendingIntent (Android). Su iOS il risveglio dà ~10 s: bastano per
  catturare il codice corrente e accodarlo.
- **Scanning BLE**: `react-native-ble-plx` (config plugin Expo).
- **Notifica one-tap** all'arrivo (`expo-notifications`).
- **Borsellino**: PowerSync React Native SDK (`@powersync/react-native` +
  `@powersync/powersync-op-sqlite`), stesso schema e stessa strategia del
  web — i codici salgono via `uploadData` alla cucitura, **mai scritture
  dirette al database**.
- **Dwell opportunistico**: campiona all'ingresso, all'uscita e quando
  l'app torna in foreground. Non promettere campionamento continuo: iOS non
  lo consente.
- Permessi: Bluetooth (Android 12+: `BLUETOOTH_SCAN` senza posizione),
  notifiche, posizione "quando in uso" per il region monitoring iOS.

### 3. Materiale per il video

Uno script/scaletta di cosa mostrare: telefono in tasca che si sveglia
entrando nel raggio, notifica one-tap, dashboard che si popola, permanenza
che cresce, e l'ESP32 fisico in mano.

## Linee di taglio (dichiarate nella spec, rispettale)

Il Tier 1 (demo web) è già consegnato e non va toccato né messo a rischio.
Se il tempo stringe, in quest'ordine:

1. Se lo scanning BLE in Expo si impantana → l'app consegna comunque
   geofence wake + push one-tap + cattura QR, e il canale radio si dimostra
   col precedente ProxiMate (vedi sotto).
2. Se anche il wake si impantana → il Tier 2 esce dal consegnato e rientra
   nel documento.

Non spendere giorni su un problema di provisioning: dichiaralo e taglia.

## Precedente riusabile: ProxiMate

Repo `FirstLayer-SRL/ProxiMate-ibeacon` (Swift, dell'utente):
`Services/IBeconService/IBeaconManager.swift` fa advertising + scanning
CoreBluetooth insieme, con restoration identifier per il background, RSSI e
heartbeat GATT tra peer. È il precedente citabile ("l'ho già costruito") e
una fonte di soluzioni per i dettagli iOS. Sul Mac dell'utente (`ssh mac`)
in `~/PROXIMATE`.

## Ambiente

- Dispositivi: iPhone dell'utente; verificare se è disponibile un Android
  (il canale radio è più comodo da dimostrare lì: advertising da foreground
  service, scanning in background più generoso).
- L'utente ha un ESP32 fisico a disposizione.
- Chiedere prima di comprare/installare qualcosa che costi o richieda
  account nuovi (es. Apple Developer per TestFlight).
