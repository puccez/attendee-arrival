# apps/mobile — app attendee (Expo + React Native)

Il lato telefono della **testimonianza co-prodotta**: il beacon fa da notaio
(ancora spazio-temporale), il telefono fa da sensore — raccoglie i **Codici
Rotanti** dall'ESP32 e ne fa eco alla stessa API della demo web.

Il telefono non giudica niente: non deriva codici, non decide se sono
validi, non calcola qualità. Raccoglie e consegna. Tutta la logica di
fiducia vive dietro la cucitura di verifica (`POST /events/:id/deliveries`).

## Cosa fa

| | |
| --- | --- |
| **Canale radio** | ascolta il frame iBeacon del beacon-notaio e legge il Codice Rotante da major/minor |
| **Risveglio in prossimità** | iOS: region monitoring CoreLocation (l'app si sveglia da chiusa). Android: scansione BLE via PendingIntent. Più il geofence dell'evento su entrambe |
| **Notifica one-tap** | all'arrivo. Il tap arricchisce la qualità, mai la provenienza |
| **Borsellino** | i codici si accumulano in SQLite locale e salgono da soli appena c'è rete |
| **Canale ottico** | se la radio non arriva, il codice si digita a mano: è lo stesso codice |
| **Dwell opportunistico** | campionamento all'ingresso, all'uscita e a ogni ritorno in foreground — non continuo, iOS non lo consente |

## Perché serve una dev build (e non Expo Go)

Il canale radio è un modulo nativo: Expo Go non lo contiene. Serve
`expo prebuild` + `expo run:*`, cioè Xcode (iOS) o Android SDK.

```bash
cd apps/mobile
npm install
npx expo prebuild --clean
npx expo run:android      # oppure: npx expo run:ios
```

### Toolchain iOS su un Mac senza Homebrew

Su un Mac con solo Xcode installato servono node e CocoaPods, e nessuno
dei due ha bisogno di `sudo` né di brew:

```bash
# node: tarball ufficiale in ~/.local
curl -fsSL https://nodejs.org/dist/v24.19.0/node-v24.19.0-darwin-arm64.tar.gz \
  | tar xz -C ~/.local/node --strip-components=1
export PATH="$HOME/.local/node/bin:$PATH"

# CocoaPods: la ruby di sistema (2.6) non basta più — le gem moderne
# pretendono >= 3.1. La portable-ruby di Homebrew è rilocabile e si
# scarica dalle release, senza installare brew.
curl -fsSL https://github.com/Homebrew/homebrew-portable-ruby/releases/download/3.4.5/portable-ruby-3.4.5.arm64_big_sur.bottle.tar.gz \
  | tar xz -C ~/.local/portable-ruby --strip-components=1
export PATH="$HOME/.local/portable-ruby/3.4.5/bin:$PATH"
export LANG=en_US.UTF-8
gem install cocoapods --no-document
```

### Compilare e installare sull'iPhone

```bash
./scripts/build-ios-device.sh          # Release (autonoma) + installazione
./scripts/build-ios-device.sh --debug  # Debug (richiede Metro in rete)
```

Non serve l'abbonamento da 99 dollari: un **Personal Team** (Apple ID
gratuito, aggiunto in Xcode → Settings → Accounts) firma per il proprio
device. Il certificato dura **7 giorni**: passati quelli l'app non parte
più e si ricompila.

Alla prima installazione, sull'iPhone: Impostazioni → Generali → VPN e
gestione dispositivo → fidati dello sviluppatore.

> **Lo script va lanciato da un Terminale sul Mac, non via SSH.** La firma
> del codice ha bisogno del portachiavi di login, a cui una sessione SSH
> non arriva: `codesign` fallisce con `errSecInternalComponent`. Tutto il
> resto — prebuild, pod install, compilazione — funziona anche da remoto,
> ed è così che questo progetto è stato verificato.

> **Fuori dal workspace pnpm.** `apps/mobile` è escluso in
> `pnpm-workspace.yaml` e ha il suo `npm install`. Tenerlo dentro
> obbligherebbe ogni build Vercel dell'API a risolvere react-native e le
> dipendenze native: il tier 1 (in produzione) non si mette a rischio per
> il tier 2. Il prezzo è che i tipi condivisi con `packages/core` sono
> ridichiarati in `src/lib/api.ts`, con il rimando alla fonte.

## Il canale radio, piattaforma per piattaforma

Il modulo nativo sta in `modules/wemeet-beacon/`. Una sola porta
TypeScript, due implementazioni — perché le due piattaforme espongono il
canale radio in modo diverso, e vale la pena dirlo:

**iOS — CoreLocation, non CoreBluetooth.** iOS *non consegna* gli annunci
iBeacon a CoreBluetooth: li riserva a CoreLocation. Qualunque libreria BLE
generica (ble-plx compresa) su iPhone non vedrebbe il beacon **affatto**.
Si usano quindi `startMonitoring` (risveglio all'ingresso nella region,
anche ad app chiusa, con permesso "Sempre") e `startRangingBeacons`
(major/minor = il codice). È il motivo per cui l'UUID è fisso: è l'identità
su cui il sistema decide di svegliare l'app. Ciò che ruota sta in
major/minor.

**Android — BluetoothLeScanner.** Android consegna i manufacturer data
grezzi: il frame arriva intatto e lo interpreta il parser condiviso
(`src/lib/ibeacon.ts`), quello testato contro il firmware. In background la
stessa scansione si registra con un `PendingIntent`: il sistema sveglia
`BeaconScanReceiver`, che accoda l'avvistamento e fa scattare la notifica
one-tap in modo nativo (l'app resta chiusa). Al risveglio l'app drena la
coda nel borsellino.

Il modulo è caricato con `requireOptionalNativeModule`: se la dev build non
lo contiene, l'app **non crasha** — resta il canale ottico. La porta della
copertura non si chiude, si etichetta.

## Provare senza ESP32

Il canale ottico è lo stesso codice: apri `GET /events/:id/code` (o la
console host) e digita le sei cifre nel campo "canale ottico". Il check-in
che ne esce è indistinguibile da quello radio — il server non sa da quale
canale è arrivato il codice, ed è il punto.

## Test e stato della verifica

```bash
npm test        # logica pura: frame iBeacon, normalizzazione, consegne
npm run typecheck
npx expo prebuild --platform android --clean
```

**Verificato senza device**: `npm install` risolve (Expo 57, RN 0.86.2,
React 19.2.3), il typecheck è pulito su due programmi separati — l'app
(React Native) e i test (node) — i 12 test passano, e `expo prebuild`
genera il progetto Android senza warning, con `wemeet-beacon` correttamente
autolinkato e tutti i permessi nel manifest.

**Verificato su macOS** (Xcode 26.6, iOS SDK 26.5): `pod install` risolve
`WemeetBeacon`, e **il modulo Swift compila** — `WemeetBeaconModule.o` e
`libWemeetBeacon.a` per arm64, zero errori, sia in Debug che in Release
(quest'ultima include il bundling JS). Il canale radio su iPhone non è
codice scritto a occhio: è codice che il compilatore ha accettato.

**Non ancora verificato**: la compilazione Gradle del Kotlin. Servono JDK
+ Android SDK + NDK (~6 GB): al primo `expo run:android` può saltare
fuori qualche divergenza nell'API nativa. Il codice usa i pattern
documentati di Expo Modules (`Record` per gli argomenti strutturati,
`CodedException` per gli errori) proprio per ridurre quella superficie.

I moduli sotto `src/lib/` e `src/beacon/normalize.ts` non importano niente
di React Native apposta: si testano con `node --test`, senza device né
emulatore. Il resto (permessi, task di background, UI) è cucitura sottile
sopra questi.

Il test più importante non è qui ma in `firmware/test/`: la **parità a tre**
fra il C che emette, il TypeScript che legge (questo parser) e il core che
verifica. `make -C firmware test`.

## Configurazione

`app.json` → `expo.extra`:

```json
{ "apiBase": "https://attendee-arrival-api.vercel.app",
  "beaconUuid": "B6C60396-4B64-44D6-84E7-54909270550C" }
```

L'UUID deve combaciare con `firmware/attendee_beacon/config.h`.
L'`eventId` non sta nel frame: lo si incolla all'avvio dell'app (te lo dà
la console dell'host), coerentemente con la spec — l'intent di check-in
include l'evento di registrazione.

## Il borsellino e PowerSync

Oggi la coda è SQLite locale (`src/wallet/wallet.ts`) con la stessa
strategia di `apps/web/app/powersync/connector.ts`: gli item si raggruppano
per evento in un'unica consegna, un 2xx o un 4xx li consumano, un 5xx o
l'assenza di rete li lascia in coda. La logica di raggruppamento
(`src/lib/delivery.ts`) è isolata e testata proprio perché è il pezzo che
PowerSync riuserebbe: sostituire la coda significa chiamare
`groupIntoDeliveries` da `uploadData` invece che da `flush`.

Lo swap a `@powersync/react-native` è preparato ma non fatto: al momento
`@powersync/op-sqlite` dichiara `@op-engineering/op-sqlite ^13–^15` mentre
la versione corrente è la 17, e risolvere quel nodo non aggiunge niente
alla dimostrazione del canale radio — il borsellino offline è già
osservabile così. La demo web resta il posto dove PowerSync gira davvero.

## Permessi

Nessuno è obbligatorio: senza radio resta il codice a mano, senza notifiche
resta l'app aperta, senza posizione resta tutto tranne il risveglio.

- **Android 12+**: `BLUETOOTH_SCAN` con `neverForLocation` — si scansiona
  senza chiedere la posizione. La posizione serve solo al geofence.
- **iOS**: posizione "Sempre". Senza, l'iPhone non sente il beacon affatto
  (vedi sopra) e non c'è risveglio da app chiusa.

## Limiti dichiarati

- **iOS in background dà ~10 secondi** per risveglio: bastano per catturare
  il codice corrente e accodarlo, non per un campionamento continuo. Il
  dwell è opportunistico per costruzione, non per pigrizia.
- **La scansione in background su Android** è a bassa potenza (duty cycle
  ~10%): gli avvistamenti arrivano a raffiche, non in flusso.
- **Il beacon non vede i telefoni.** La direzione è telefono-ascolta: in
  background iOS è invisibile e i MAC ruotano. Il beacon non sa chi c'è, ed
  è una proprietà del design, non un limite.
