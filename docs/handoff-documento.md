# Handoff — Traccia A: il documento di risposta al business case

> Dossier di contesto per chi lavora al documento. Leggi anche `CONTEXT.md`
> (glossario) e `docs/spec.md` (spec tecnica). Non modificare `docs/spec.md`
> né `apps/mobile/` e `firmware/`: sono della traccia B.

## Il compito

WeRoad chiede di ripensare il check-in dei WeMeet. Consegna attesa: un
documento (formato libero) entro una settimana. Il brief (`~/Downloads/tech-wemeet-1-.pdf`)
chiede tre cose e ne dichiara una non-negoziabile.

**I tre requisiti:**
1. Arrivo auto-rilevato via geofencing attorno al luogo dell'evento.
2. Notifica one-tap di conferma quando l'attendee è dentro il geofence.
3. QR code come fallback quando il geofencing non è affidabile.

**Il non-negoziabile:** mostrare come si fermano i check-in falsi — GPS
spoofato, amico che conferma per te, QR screenshottato/inoltrato, check-in
e fuga immediata.

**Domande esplicite del brief da coprire:** quali segnali distinguono una
posizione genuina da una spoofata; cosa succede se l'attendee ignora la
notifica; come l'host vede lo stato in tempo reale; edge case (eventi
back-to-back nello stesso venue, attendee senza connessione dati,
check-in di gruppo).

Contesto prodotto: WeMeet sono eventi social gratuiti settimanali in
decine di città, 20–100 persone, venue tipo bar/locali, host = coordinatori
volontari della community. Lo stack WeRoad (confermato): TypeScript ovunque,
API NestJS, frontend Vue/Nuxt, app React Native + Expo.

## La tesi

**La posizione si dichiara, la prossimità si dimostra, la permanenza si
conferma.** Ogni check-in porta l'etichetta di chi lo ha confermato.

Il meccanismo unico: un **beacon-notaio** al venue (telefono dell'host di
default, ESP32 dove conviene) emette un **Codice Rotante** — un segreto
effimero (30 s) derivato da un seme per-evento, conoscibile solo stando lì
in quel minuto. Il telefono lo raccoglie e ne fa eco al server, che
ricalcola e verifica. Un solo codice, due canali: **radio** (BLE,
automatico, funziona indoor) e **ottico** (QR, universale, nessun permesso).

Il GPS è retrocesso a UX: sveglia l'app e innesca la notifica one-tap, non
è mai una prova. Per questo lo spoofing GPS diventa irrilevante per
costruzione, invece che "rilevato con euristiche".

Ogni check-in è etichettato su **due assi ortogonali** (non una scala):
- **provenienza** — macchina (codici verificati) / umano (l'host ha
  verificato la persona) / nessuno. Macchina e umano non sono ordinate: la
  prima prova il *device*, la seconda la *persona*; il caso più forte le ha
  entrambe;
- **qualità** — quanti codici, su che arco di tempo (dwell), tap sulla
  notifica.

Chi consuma il dato decide quanto vale ogni combinazione: la frode ai
livelli bassi non è prevenuta, è **prezzata**.

## Onestà architetturale (il box che fa la differenza)

Un valutatore tecnico competente cerca questi punti. Dichiararli per primi
vale più di nasconderli — è la raccomandazione di un reviewer adversariale
che ha già stressato il modello.

- **Il beacon non "vede" i telefoni.** Un'app iOS in background finisce
  nella overflow area di Apple e un ESP32 non la vede; i MAC BLE ruotano.
  La direzione reale è telefono-ascolta / beacon-parla: la testimonianza è
  **co-prodotta** (beacon = ancora spazio-temporale, telefono = sensore).
  Precedente citabile: Exposure Notifications di Apple/Google usa lo stesso
  schema di token rotanti, ed è anche la variante migliore per la privacy
  (il beacon non logga nessuno).
- **Il dwell è opportunistico, non continuo.** iOS dà ~10 s di esecuzione
  al risveglio iBeacon; l'ingresso e l'uscita dalla region sono garantiti,
  i campioni in mezzo arrivano quando l'utente apre il telefono (frequente
  a un aperitivo) o su silent push. Su Android lo scanning in background
  via PendingIntent è più generoso.
- **La finestra di frode residua è ~60 s.** Un codice vale la sua finestra
  (30 s) più una di tolleranza per lo skew d'orologio: uno screenshot
  inoltrato entro il minuto funziona. Per battere il sistema serve qualcuno
  fisicamente presente che inoltri codici *per tutta la serata* — il dwell
  è la difesa anti-relay principale, non solo l'anti "tocca e fuggi".
- **La porta della copertura non si chiude, si etichetta.** Telefono
  spento, permessi negati, niente app: ogni design ha attendee non
  rilevabili. Le "cure" (biometria centralizzata, documento d'identità,
  niente fallback) costano più del male per un evento social gratuito. Il
  fallback è il testimone umano — l'host — con la sua frode sociale
  dichiarata.
- **Telefono ≠ persona.** Il binding device↔account resta il limite; si
  mitiga con biometria on-device (FaceID/WebAuthn user verification) e, in
  produzione, con device attestation (Play Integrity / App Attest).
- **ESP32 senza RTC.** Un power-cycle azzera l'ora e i codici diventano
  invalidi: serve il battito del beacon in dashboard, altrimenti il venue
  degrada in silenzio. È anche l'argomento per cui il default è il telefono
  dell'host (ora di rete sempre giusta, connettività, zero flotta da
  gestire) e l'hardware è un'ottimizzazione per i venue ricorrenti.

## Cosa esiste già (materiale per il documento)

Repo: `github.com/puccez/attendee-arrival` — Turborepo TypeScript, stack
identico a WeRoad.

- **Demo web live**: https://attendee-arrival-web.vercel.app
  (console host col QR rotante e dashboard live, vista attendee con
  fotocamera e borsellino offline, sandbox d'attacco).
- **API**: https://attendee-arrival-api.vercel.app (`/health` dichiara lo
  store attivo).
- **`packages/core`** — derivazione del Codice Rotante (HMAC-SHA256,
  troncatura stile RFC 4226, 6 cifre: compatta per i campi major/minor di
  un frame iBeacon) e valutazione delle consegne. 13 test.
- **`apps/api`** — modulo NestJS della cucitura di verifica, sollevabile
  nel backend WeRoad così com'è. 7 test e2e.
- **`apps/web`** — Nuxt/Vue: console, attendee, sandbox d'attacco.
- **PowerSync Cloud + Supabase** — borsellino local-first vero: i codici si
  raccolgono in SQLite locale (funziona offline) e salgono via `uploadData`
  alla cucitura, mai scritture dirette al database; lo stato etichettato
  torna giù dal sync stream.
- **Sandbox d'attacco** (`/attacker/:id`): i quattro attacchi del brief più
  il replay oltre finestra, ognuno con esito etichettato che atterra sulla
  dashboard dell'host.

Diagramma già pubblicato del meccanismo (utile da riusare o rifare):
https://claude.ai/code/artifact/b8c64958-6e35-4683-bc78-86a3963f2572

Traccia B (in parallelo): app Expo con BLE reale + firmware ESP32 + video.
Coordinati con quella per i riferimenti al canale radio.

## Struttura consigliata del documento

1. **Apertura con tabella di tracciabilità** requisito → risposta. È la
   mossa che evita di sembrare "brillante ma fuori traccia": il brief
   chiede geofencing/notifica/QR e il documento parla di beacon e
   testimoni. Mostrare subito che i tre requisiti ci sono tutti, e che il
   ribaltamento *è* la risposta al non-negoziabile.
2. **Il problema**: il check-in sull'onore e cosa significa fidarsi.
3. **Il meccanismo**: beacon-notaio, codice rotante, due canali. Diagramma.
4. **Il flusso**: arrivo → notifica one-tap → prova di prossimità →
   permanenza. Cosa vede l'attendee, cosa vede l'host.
5. **Anti-frode**: le quattro frodi una per una, con il link alla sandbox
   dove il valutatore le prova. Include mezza pagina sui segnali
   genuino-vs-spoofato del GPS (il brief lo chiede esplicitamente) —
   presentati come informativi per il livello "nessuno", non come difesa
   principale.
6. **Edge case**: back-to-back (seme per-evento + finestre orarie), niente
   connessione dati (prova autodatante + borsellino), gruppi (rifiutare
   esplicitamente il "garantisco io per i miei amici": è l'attacco del
   brief; la risposta è host o QR del proprio biglietto), notifica ignorata
   (cascata: tap → dwell ricco; ignorata → campionamento opportunistico;
   nulla → prompt all'host in dashboard).
7. **Reality check**: il box di onestà architetturale qui sopra.
8. **Rollout e integrazione**: telefono-host dal giorno uno → ESP32 nei
   venue ricorrenti; moduli innestabili nello stack WeRoad (modulo NestJS,
   modulo Expo, componenti Nuxt); privacy/GDPR (minimizzazione del dwell,
   il design telefono-ascolta è privacy-ottimale).
9. **Evoluzioni**: attestation, testimonianza tra pari
   (`docs/espansioni-future.md`), UWB.

Tono: da ingegnere che consegna, non da venditore. Ogni claim quantitativo
deve essere vero (niente "dwell gratis", niente "impossibile da frodare").
Italiano, salvo che l'utente chieda inglese.
