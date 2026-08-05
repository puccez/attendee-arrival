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

---

## Due riscritture richieste (4 agosto 2026)

Il documento è indietro rispetto al codice su due punti. Entrambi migliorano
la consegna: il primo aggiunge l'unico aneddoto in cui una prova sul campo ha
corretto il design, il secondo risponde a un'obiezione che il documento oggi
lascia scoperta.

### 1. Riscrivere §6.4 «Check-in e fuga» — il caso esci-e-rientra

Oggi §6.4 copre solo *entro, timbro, scappo* (1 codice, 0 minuti di copertura),
che era già giusto. Manca il caso più interessante, ed è successo davvero.

**Cos'è successo.** Test sul campo del 4 agosto, geofence di 150 m sulla casa
dell'autore. Uscita, 17 minuti a 400 metri, rientro. La dashboard ha mostrato
la copertura passare da 7 a **24 minuti**: aveva accreditato come permanenza
anche il tempo passato fuori. La copertura era calcolata come *arco* fra il
primo e l'ultimo codice — che per chi resta è una buona approssimazione, e per
chi esce e rientra è esattamente l'errore che il brief chiede di non fare.

**Come è stato risolto.** Due meccanismi, in quest'ordine di importanza:

- **Il tetto per buco** (la difesa che non si fida di nessuno): fra due codici
  consecutivi si accreditano al massimo 10 minuti. Non serve sapere se
  l'attendee è uscito: se in mezzo non abbiamo sentito niente, non
  accreditiamo niente oltre il tetto. La copertura diventa così un **limite
  inferiore per costruzione** — la §9.1 lo affermava già, ora è letteralmente
  vero.
- **Le sessioni di presenza** (la precisione, quando il client collabora):
  iOS notifica l'uscita dalla region del beacon (`didExitRegion`), l'unico
  segnale di *fine presenza* che un beacon non-connettibile lascia — non ti
  vede, quindi non può accorgersi che te ne vai; il sistema operativo sì. Se
  il telefono dichiara l'uscita, l'intervallo che la contiene non si accredita
  affatto.

**Il punto da far passare, ed è il migliore della sezione:** le sessioni
arrivano da un client non fidato, quindi il sistema è costruito perché non
possano essere sfruttate. Dichiarare una sessione lunga tre ore con un codice
solo dà **zero**. Non dichiarare niente per farsi accreditare l'assenza dà
**19 minuti invece di 26**, perché il tetto vale comunque. Le sessioni possono
solo *tagliare*, mai allungare. È il motivo per cui è sicuro accettarle.

Numeri veri dal test, usabili in tabella (`packages/core/test/verification.test.ts`):

| | copertura | buco massimo |
|---|---|---|
| l'arco (com'era prima) | 26 min | — |
| il telefono tace | 19 min | 17 min |
| il telefono dichiara l'uscita | **9 min** | 17 min |

E accanto: chi è rimasto davvero raccogliendo un codice ogni due minuti ottiene
copertura densa e buco massimo di 2 minuti. La differenza fra chi resta e chi
esce si legge in due colonne, senza soglie che decidano chi è «rimasto
abbastanza».

Vale la pena dire esplicitamente che il difetto è stato trovato **camminando**,
non leggendo il codice. È l'argomento più forte a favore di aver costruito una
demo vera invece di un mockup.

### 2. Nuova sezione: perché non un challenge-response

Testo pronto in **`docs/paradigma.md`**, già scritto nel registro giusto
(ogni termine tecnico spiegato la prima volta che compare — chi legge il
business case non è detto che conosca il BLE).

Contiene: le due forme di prova a confronto, la tabella dei trade-off, il
vincolo iOS che rende il dialogo impossibile a schermo spento, il costo che
paghiamo (il codice non è legato al tuo telefono → relay entro il minuto), e
la proposta del **beacon dual-mode** — broadcast per tutta la serata, dialogo
domanda-e-risposta una volta sola, al tap sulla notifica, quando l'app è in
primo piano e la connessione è possibile.

Dove collocarla: naturale come **§3.5**, subito dopo «il flusso, per intero»,
oppure come box dentro §9.1 (reality check). La prima posizione è meglio: è una
scelta di design, non un limite.

La frase da tenere: alla domanda *«perché non un challenge-response?»* la
risposta non è «non serve», è **«serve dove una connessione c'è, e per il 99%
della serata una connessione non c'è»**.

Il dual-mode va anche aggiunto a §12 Evoluzioni, insieme ad App Attest /
Play Integrity e al FaceID sul tap (la scala dei rinforzi in coda a
`docs/paradigma.md`, in ordine di convenienza).

---

# Correzioni dopo la review indipendente (5 agosto 2026)

Una review adversariale con GPT-5.6 (contesto: brief integrale + business dei
WeMeet) ha letto il codice **e attaccato l'API in esecuzione**. Ha trovato un
errore vero, e non un dettaglio: **§6.3 dice una cosa falsa sulla frode n°3 del
non-negoziabile**. Il codice è stato corretto; qui sotto ci sono le riscritture.

Copia integrale della review: `~/Work/wemeet/review-gpt56-sol.md`.

## 0. Il fatto, prima delle riscritture

Il server verifica due cose e solo due: che il codice corrisponda alla finestra
dichiarata, e che la consegna arrivi entro la finestra di consegna (6 ore).

Quindi lo screenshot inoltrato **non muore dopo 60 secondi**. Muore solo se chi
lo riceve *mente* sull'ora di raccolta: il codice è autodatante, e una finestra
sbagliata non corrisponde. Se dichiara l'ora vera — cioè se dice la verità — il
codice passa, e passa per sei ore.

La sandbox non lo mostrava perché al momento dell'inoltro **riscriveva il
timestamp con l'ora corrente**: stava simulando l'attaccante ingenuo. Ora ha due
bottoni, «l'ho appena preso io» e «me l'ha girato lui alle 21:14», e il secondo
passa. È una dimostrazione migliore, non peggiore: fa vedere che il codice è
davvero autodatante *e* che questo non basta a impedire l'inoltro.

Detto in una riga: **un Codice Rotante è un titolo al portatore.** Chi ce l'ha
lo spende. Legarlo al device richiederebbe un dialogo domanda-e-risposta, che è
esattamente ciò che iOS non concede a schermo spento (`docs/paradigma.md`).

## 1. §6.3 — riscrittura integrale

> ### 6.3 QR screenshottato e inoltrato
>
> **L'attacco.** Screenshotti il QR e lo giri su WhatsApp a chi è rimasto a casa.
>
> **Cosa succede.** Dipende da quanto è sveglio chi lo riceve, e il risultato è
> il contrario di quello che ci si aspetta.
>
> Se dichiara di aver raccolto il codice *adesso*, viene respinto: il server
> ricalcola dal seme il codice atteso per l'istante dichiarato, e quello di due
> minuti fa non corrisponde. Il Codice Rotante è autodatante, e **mentire
> sull'ora lo rompe**.
>
> Se invece dichiara l'ora vera — le 21:14, quando il complice l'ha
> effettivamente inquadrato — **il codice passa**, e continua a passare finché
> resta aperta la finestra di consegna (sei ore). Dire la verità funziona.
>
> **Perché è così, e perché lo diciamo.** Un codice trasmesso in broadcast è un
> titolo al portatore: chiunque lo riceva può spenderlo. Non c'è modo di legarlo
> al telefono che l'ha sentito senza un dialogo domanda-e-risposta fra device e
> venue — che è precisamente ciò che iOS non permette a schermo spento (§3.5).
> Questa è la frode che il design **non previene**, ed è l'unica.
>
> **Cosa la rende comunque irrazionale.** Tre cose, in ordine di forza:
>
> 1. **Serve un complice fisicamente al venue.** Non un exploit: una persona che
>    è lì e che avrebbe potuto semplicemente portarti con sé. Per un aperitivo
>    gratuito, il costo dell'attacco supera il valore del bottino prima ancora di
>    cominciare.
> 2. **Il ritardo di consegna è visibile.** Il server timbra ogni codice quando
>    arriva la prima volta — è l'unico istante della consegna che non viene dal
>    client. Chi è al venue consegna in diretta: ritardo di secondi. Chi riceve
>    codici inoltrati li consegna dopo: la dashboard dice *prova vecchia di 47
>    minuti quando è arrivata*.
> 3. **La copertura resta bassa a meno di insistere.** Un codice solo dà zero
>    minuti. Per costruire una serata credibile servono codici distribuiti nel
>    tempo — e quindi un complice che continua a inoltrare.
>
> **Onestà sul numero.** Servono meno inoltri di quanti sembri: siccome fra due
> codici consecutivi si accreditano al massimo 10 minuti (§6.4), **una tredicina
> di codici basta a costruire due ore di copertura**, e possono essere girati
> tutti insieme a fine serata. Non uno ogni 30 secondi per l'intera serata: non
> vogliamo che questo numero sembri più grande di quello che è.
>
> **Quello che il ritardo non fa.** Non distingue il complice dall'attendee
> onesto rimasto senza rete tutta la sera: per il server sono lo stesso fatto —
> prove vere, arrivate tardi. È per questo che il ritardo entra nella *qualità*
> e non nella *provenienza*: descrive, non giudica. Chi consuma il dato sa che
> «consegnato in diretta» e «consegnato tre ore dopo» sono due qualità di prova
> diverse, e decide.
>
> **Il rinforzo, quando servisse.** Il beacon dual-mode di §3.5 — un dialogo
> domanda-e-risposta una volta sola, al tap sulla notifica — lega quel singolo
> istante al device e chiude la finestra. Non è nella prima versione perché per
> un evento gratuito il costo dell'attacco è già superiore al premio.

## 2. §6.5 — la sandbox dimostra altro, adeguare

Il bottone bonus ora manda **sei cifre a caso datate 13 ore fa**, e il rifiuto
ha due ragioni indipendenti che vale la pena mostrare insieme:

- il codice inventato non corrisponde a nessuna finestra: lo spazio è 10⁶ e il
  server accetta tre finestre, quindi **una probabilità su ~333.000** per
  tentativo;
- e comunque la consegna arriva oltre la finestra dichiarata.

Da aggiungere nella stessa sezione, perché la review l'ha sollevato ed è giusto:
**la demo non ha rate limiting**, quindi «poco pratico» non è «impedito». In
produzione è una riga di middleware. §9.2 lo dice già: qui va solo richiamato.

## 3. «machine prova quel device» — affermazione da correggere ovunque

Compare in §4 e in §6.1. Non è vera: il `deviceId` lo sceglie il client, e i
codici sono al portatore. La formulazione corretta:

> **macchina** — un codice emesso al venue in quel minuto è arrivato al server
> attraverso questo account. Prova che *qualcuno* era lì e che la prova è
> passata di qui — non *quale* telefono l'ha sentita. Il legame device↔persona
> resta il limite strutturale (§9.1), ed è esattamente perché esiste che
> `umano` è un asse separato.

## 4. §4 — la tabella della qualità guadagna una colonna

La qualità ora ha quattro numeri: codici validi, copertura, buco massimo,
**ritardo di consegna**. Righe d'esempio suggerite:

| Provenienza | Qualità | Lettura |
|---|---|---|
| macchina | 97 codici, 94 min, ritardo 0 | C'era, è rimasta, consegnava in diretta |
| macchina | 13 codici, 120 min, **ritardo 148 min** | Copertura piena ma tutta arrivata a fine serata: o era offline, o i codici gliel'ha girati qualcuno |
| macchina | 1 codice, 0 min, ritardo 0 | C'era per un istante, ed era davvero lì |

La riga di mezzo è quella che vale la pena commentare: **è la stessa riga per
l'attendee onesto senza rete e per il complice remoto.** Il sistema non finge
di saperlo distinguere. Lo mostra e lascia decidere.

## 5. §9.1 — un limite in più nel reality check

> **Il codice è un titolo al portatore.** La prova viaggia in broadcast, quindi
> chi la riceve può passarla. Il sistema non può accorgersene: può solo misurare
> quanto era vecchia quando è arrivata. Chiudere questa finestra richiede un
> canale bidirezionale (§3.5) o l'attestazione hardware del device — entrambi
> previsti, nessuno dei due gratuito.

## 6. §9.2 — la riga sull'autenticazione va chiusa fino in fondo

La tabella dice già «nessuna autenticazione». Non basta: va detta la
**conseguenza**, perché un valutatore tecnico la scopre in cinque minuti e la
scoperta deve essere nostra, non sua.

> **La demo è aperta di proposito**, così si può provare senza registrarsi. La
> conseguenza è che `GET /events/:id/code` risponde a chiunque: da riga di
> comando ci si accredita `macchina` dal divano, senza essere mai stati al
> venue. In produzione quell'endpoint appartiene all'host, come la dashboard e
> la testimonianza manuale. **Quello che la demo dimostra è la cucitura di
> verifica, non il perimetro** — e le due cose vanno lette separate.

Da aggiungere alla tabella di §9.2, perché la review le ha trovate e sono vere:

| Oggi nella demo | In produzione |
|---|---|
| La finestra oraria dell'evento non è applicata: un codice raccolto fuori orario passa | Filtro `startsAt ≤ collectedAt ≤ endsAt` (il dato è già nel modello) |
| Un `collectedAt` nel futuro non viene rifiutato | Controllo `collectedAt ≤ deliveredAt` |
| Le consegne concorrenti fanno `carica → unisci → salva` senza lock | Transazione, o `INSERT … ON CONFLICT` con merge lato database |
| Lo stesso codice accredita device diversi | È **corretto e necessario**: al venue tutti sentono lo stesso codice. Non è un buco, è il broadcast |

## 7. Cosa è cambiato nel codice (per §10 e per l'appendice)

- **La testimonianza umana ha un endpoint suo**: `POST /events/:id/attestations
  {deviceId, attendeeName?}`. `hostAttested` **non esiste più** nel payload di
  `POST /deliveries` — l'appendice va aggiornata. Da qui nasce anche la riga di
  chi non ha mai consegnato niente, che è il gradino 4 di §7.2 (telefono
  scarico) finalmente coperto dall'API e non solo dal testo.
- **La qualità ha un campo nuovo**: `deliveryLagMinutes`.
- **I conteggi dei test**: core **23** (erano 13), e2e **12** (erano 7).

Appendice, risposta aggiornata:

```
→ 201 {
  "accredited": true,
  "provenance": "machine",
  "quality": {
    "validCodes": 12, "coverageMinutes": 94,
    "longestGapMinutes": 7, "deliveryLagMinutes": 0,
    "tappedNotification": true
  }
}
```

## 8. Una nota di metodo che vale la pena mettere nel documento

Il difetto di §6.4 è stato trovato **camminando** (handoff precedente). Questo
di §6.3 è stato trovato **facendo attaccare il sistema da un revisore
indipendente**. Nessuno dei due si vedeva rileggendo il proprio codice.

Se c'è spazio in §9, una riga onesta su questo vale più di una difesa in più:
il modo in cui un design viene messo alla prova conta quanto il design.

## 9. §10 — «un solo endpoint di scrittura» non regge più

La frase era già scaduta con la telemetria; ora ci sono tre porte in scrittura, e
la distinzione fra loro **è** il modello, quindi conviene raccontarla invece di
nasconderla:

> **`POST /events/:id/deliveries`** — la cucitura di verifica: ciò che
> l'attendee afferma di aver raccolto. È l'unica porta che può produrre
> provenienza `macchina`, e tutto ciò che vi entra viene ricalcolato dal seme.
>
> **`POST /events/:id/attestations`** — ciò che l'host afferma di aver visto.
> Unica porta per `umano`. Separata di proposito: se la testimonianza fosse un
> campo della consegna, il borsellino di un attendee potrebbe accreditarsi da
> solo la parola di qualcun altro.
>
> **`POST /events/:id/telemetry`** — ciò che il telefono ha fatto. Non tocca il
> giudizio e non gli passa nemmeno accanto: serve a spiegare i silenzi.

Tre porte, tre livelli di fiducia, nessuna sovrapposizione. È una frase più
forte di «un solo endpoint».
