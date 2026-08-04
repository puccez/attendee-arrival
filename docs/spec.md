# Spec — Demo "sandbox d'attacco" del check-in WeMeet (beacon-notaio)

> Triage: `ready-for-agent` (nessun issue tracker configurato per il progetto: la spec vive qui).
> Vocabolario: vedi `CONTEXT.md` (glossario di dominio). Espansioni rimandate: `docs/espansioni-future.md`.

## Problem Statement

Il check-in dei WeMeet oggi è un tap sull'onore: WeRoad non sa chi c'era davvero, per quanto è rimasto, e chiunque può risultare presente dal divano. Il business case chiede un flusso basato su geofencing, notifica one-tap e QR di fallback, con un non-negoziabile: dimostrare come si fermano i check-in falsi (GPS spoofato, amico che conferma per te, QR screenshottato, check-in-e-fuga).

Chi valuta l'elaborato deve poter **provare la soluzione da solo, subito, da un link** — su iPhone o Android, senza installare nulla — e deve poter **provare a fregarla** e vedere il sistema reggere.

## Solution

Una web app deployata con due facce collegate in tempo reale:

- **Console host** (laptop): crea l'evento, emette il Codice Rotante come QR che cambia ogni 30 secondi, mostra la dashboard degli arrivi con l'etichetta a due assi (provenienza × qualità) e permette la testimonianza umana manuale.
- **App attendee** (telefono, browser): rileva l'Arrivo via geofence GPS reale ("crea evento demo qui" → ti allontani e torni), riceve l'invito one-tap, inquadra il QR rotante per produrre la prova di prossimità, accumula i codici nel borsellino offline (PowerSync) e li consegna quando torna la rete.

Il tutto in formato **sandbox d'attacco**: una "cassetta degli attrezzi del frodatore" integrata (spoofa il GPS, screenshotta il QR, replaya codici vecchi, scappa dopo il check-in) che mostra dal vivo come ogni frode viene etichettata o respinta. Una modalità simulazione (mappa con omino trascinabile) copre chi prova la demo senza muoversi dalla sedia.

Il deliverable è a due livelli, entrambi in scope:

- **Tier 1 — web (garantito)**: quanto sopra. Il canale radio nel browser non esiste: nella demo web è dichiarato e rappresentato (stesso codice, trasporto diverso). La demo web è l'esperienza web *vera* del prodotto: il livello di fallback del sistema reale, non una simulazione del nativo.
- **Tier 2 — app nativa attendee (React Native + Expo)**: il canale radio vero. L'ESP32 emette il Codice Rotante come iBeacon; l'app si sveglia all'ingresso nel raggio (region monitoring), cattura i codici via BLE senza gesti, manda la push one-tap reale, campiona il dwell opportunisticamente e usa lo stesso borsellino PowerSync. Stessa API di verifica del tier 1: il server non distingue i client. Il video della demo si gira con QUESTA app; ProxiMate resta il precedente citabile, non il dimostratore.

## User Stories

### Recruiter / valutatore (visitatore della demo)
1. As a recruiter, I want ad aprire la demo da un link su laptop e telefono senza installare nulla, so that posso giudicare la soluzione in due minuti.
2. As a recruiter, I want un percorso guidato ("apri la console qui, l'attendee sul telefono via questo QR"), so that non devo capire da solo come si collega la coppia di schermi.
3. As a recruiter, I want una modalità simulazione con un attendee trascinabile sulla mappa, so that posso provare il flusso senza alzarmi dalla sedia.
4. As a recruiter, I want un bottone "crea evento demo qui" centrato sulla mia posizione, so that il geofencing lo provo con il MIO GPS, non con un filmato.
5. As a recruiter, I want una cassetta degli attrezzi del frodatore (spoof GPS, screenshot QR, replay codici, check-in-e-fuga), so that posso attaccare il sistema e vedere come reagisce.
6. As a recruiter, I want vedere l'esito di ogni attacco atterrare in dashboard con l'etichetta giusta, so that il non-negoziabile del brief è dimostrato performativamente, non promesso.
7. As a recruiter, I want un pannello "perché mi fido di questo check-in" (i codici consegnati, i minuti coperti, chi ha testimoniato), so that capisco il modello di fiducia guardandolo.
8. As a recruiter, I want che la demo dichiari onestamente cosa il web non può fare (BLE, background), so that il confine tra demo e prodotto nativo sia esplicito.

### Attendee
9. As an attendee, I want che l'app rilevi il mio Arrivo nel geofence dell'evento, so that il check-in mi si prepari da solo.
10. As an attendee, I want una notifica/invito one-tap quando risulto arrivato, so that confermare la presenza costi un solo gesto.
11. As an attendee, I want inquadrare il QR rotante del venue con la fotocamera, so that produca una prova di prossimità che nessuno screenshot può replicare.
12. As an attendee, I want che i codici raccolti finiscano in un borsellino locale anche senza rete, so that il check-in non fallisca perché nel locale non c'è campo.
13. As an attendee, I want che il borsellino si consegni da solo quando torna la rete, so that non debba ricordarmi di "sincronizzare".
14. As an attendee, I want vedere lo stato del mio check-in (in attesa, accreditato, qualità), so that sappia se la mia presenza è registrata.
15. As an attendee, I want ri-inquadrare il QR più tardi nella serata, so that la mia permanenza (dwell) risulti e il mio check-in salga di qualità.
16. As an attendee, I want fare check-in anche se ho negato i permessi di localizzazione, so that il GPS resti un aiuto e mai un requisito (il codice basta).
17. As an attendee, I want che ignorare la notifica non mi cancelli, so that l'host mi veda comunque come "arrivata, non confermata" e possa gestirmi.

### Host
18. As a host, I want creare un evento con venue, orario e geofence, so that il sistema sappia dove e quando testimoniare.
19. As a host, I want una console che emette il Codice Rotante come QR a schermo, so that il mio telefono/laptop sia il beacon-notaio del venue.
20. As a host, I want che la console derivi i codici localmente dal seme dell'evento, so that continui a funzionare anche se la MIA rete cade.
21. As a host, I want una dashboard in tempo reale degli attendee (arrivati, accreditati, in attesa, sospetti), so that colpo d'occhio e accoglienza restino il mio lavoro, non la burocrazia.
22. As a host, I want vedere provenienza e qualità di ogni check-in, so that distingua "macchina, tutta la serata" da "solo GPS, mai visto".
23. As a host, I want un prompt per gli "arrivati ma non testimoniati", so that possa verificarli di persona con un tap (testimonianza umana).
24. As a host, I want spuntare manualmente chi non ha app/telefono/permessi, so that nessuno resti fuori dal dato — etichettato per quello che è.
25. As a host, I want vedere il battito del beacon ("check-in attivo da 47 min"), so that mi accorga subito se l'emissione è morta.
26. As a host, I want che due eventi back-to-back nello stesso venue restino distinti, so that i codici dell'evento A non accreditino presenze sull'evento B.

### Server / consumatori del dato (WeRoad)
27. As a data consumer, I want che ogni check-in porti provenienza (macchina / umano / nessuno) e qualità (codici, arco temporale, tap), so that ogni consumatore decida quanto vale ogni combinazione.
28. As a data consumer, I want che i codici scaduti, replayati o di un altro evento vengano respinti alla verifica, so that la frode costi un complice sul posto, non un messaggio.
29. As a data consumer, I want che le consegne in ritardo (offline) vengano accreditate per i minuti dei codici dentro una finestra dichiarata, so that l'offline non sia un caso d'errore né un buco di replay illimitato.
30. As a data consumer, I want che il "check-in-e-fuga" risulti dalla qualità (pochi codici, arco breve), so that la permanenza si confermi invece di presumersi.
31. As a data consumer, I want che il GPS da solo non produca mai un check-in accreditato, so that lo spoofing GPS sia irrilevante per costruzione.

### Attendee (app nativa)
32. As an attendee, I want che l'app si svegli quando entro nel raggio del beacon (iBeacon region monitoring), so that il check-in si prepari col telefono in tasca.
33. As an attendee, I want ricevere una push reale one-tap all'Arrivo, so that confermi la presenza senza nemmeno aprire l'app.
34. As an attendee, I want che l'app catturi i Codici Rotanti via BLE dall'ESP32 senza alcun gesto, so that la prova di prossimità sia automatica e funzioni indoor dove il GPS muore.
35. As an attendee, I want che i campioni di permanenza si raccolgano opportunisticamente (risvegli di sistema, silent push), so that il dwell risulti senza consumarmi la batteria.
36. As an attendee, I want lo stesso account e lo stesso borsellino tra web e nativo, so that l'esperienza degradi con grazia tra i livelli del sistema.

### Ingegnere WeRoad (integrazione)
37. As a WeRoad engineer, I want un contratto di integrazione (API di verifica + formato del frame beacon + modulo client sottile), so that il check-in si innesti nella nostra app esistente qualunque sia il nostro stack.
38. As a WeRoad engineer, I want che tutta la logica di fiducia viva lato server, so that i client — nostri o di riferimento — restino sottili e sostituibili.

## Implementation Decisions

- **Architettura — stack WeRoad confermato (2026-08-04), adottato 1:1**: Turborepo, tutto TypeScript. API Node + NestJS — la cucitura di verifica è un modulo NestJS, sollevabile e innestabile nel loro backend così com'è; frontend Vue + Nuxt — console host e app attendee web su route distinte, collegate dallo stesso evento; app React Native + Expo. Supabase come infrastruttura dati (Postgres, Realtime per la dashboard); PowerSync per il borsellino offline (web SDK e React Native SDK). Deploy su Vercel (Nuxt e NestJS).
- **Il notaio è un ruolo**: nella demo lo gioca la console host (laptop o telefono via browser). La console riceve il **seme per-evento** alla creazione e deriva i codici localmente — l'emissione ottica sopravvive alla caduta di rete dell'host.
- **Codice Rotante**: derivazione TOTP-style — HMAC(seme dell'evento, finestra temporale di 30 s) troncato. Il server, che conosce seme e orologio, ricalcola e confronta; accetta la finestra corrente e l'adiacente (skew di orologio). Il seme non lascia mai il server se non verso la console dell'evento.
- **Cucitura unica — API di verifica**: un solo endpoint di consegna: `(evento, device, codici[con timestamp], contesto GPS opzionale, tap) → check-in etichettato (provenienza × qualità)`. Tutta l'intelligenza (validità dei codici, finestra di ritardo, attribuzione all'evento giusto nei back-to-back, calcolo del dwell, retrocessioni) vive dietro questa porta. La testimonianza umana dell'host passa dalla stessa porta con provenienza "umano".
- **Etichetta a due assi** (da `CONTEXT.md`): provenienza discreta (macchina / umano / nessuno — non ordinata: macchina prova il device, umano la persona) × qualità continua (numero di codici, arco temporale coperto, tap sulla notifica). Nessun trust score opaco.
- **Finestra di consegna in ritardo**: le consegne offline sono accettate entro una finestra dichiarata (ordine di ore, configurabile per la demo) e accreditate per i minuti dei codici; oltre la finestra, respinte. Il margine di replay residuo è documentato, non nascosto.
- **Arrivo e notifica**: geolocation del browser con pagina aperta (geofence circolare lato client, conferma lato server); l'invito one-tap è in-page (le Web Push su iOS richiederebbero PWA installata — fuori dal percorso principale della demo). L'Arrivo non è mai un check-in.
- **Sandbox d'attacco**: gli attacchi sono azioni prime-class della UI demo (non easter egg): spoof di posizione (teletrasporto dell'omino), consegna di un codice scaduto/replay, "screenshot" del QR (codice congelato), uscita immediata dopo il check-in. Ogni attacco produce l'esito etichettato in dashboard con la spiegazione.
- **Canale radio**: nella demo web rappresentato come canale del medesimo codice (stessa verifica), marcato "trasporto nativo — qui simulato"; nell'app nativa è reale (scanning BLE dei frame dell'ESP32).
- **App nativa attendee (tier 2)**: React Native + Expo con dev build e config plugin — scelta confermata dallo stack WeRoad (la loro app è già RN + Expo: il modulo attendee è direttamente innestabile). Scanning BLE (ble-plx), region monitoring iBeacon per il wake su iOS, push Expo per l'one-tap, PowerSync React Native SDK per lo stesso borsellino del web.
- **Beacon della demo nativa: ESP32** con firmware minimale — iBeacon con UUID fisso (identità: è ciò su cui iOS sveglia l'app) e Codice Rotante troncato nei campi major/minor, derivato dal seme. L'advertising nativo host-side (telefono dell'host come emettitore) non serve alla demo: lo copre l'ESP32.
- **Plug-and-play = contratto, non framework**: l'integrazione con i sistemi WeRoad è la cucitura stessa — API di verifica + spec del frame beacon + modulo client sottile. I client (web e Expo) sono implementazioni di riferimento; la logica di fiducia vive tutta lato server, quindi lo stack del client è sostituibile senza toccare il sistema.
- **Monorepo Turborepo con core TypeScript condiviso** (`packages/core`: derivazione dei codici, modelli di dominio, client dell'API, logica del borsellino) consumato da NestJS, Nuxt ed Expo: il meccanismo si scrive una volta e i tre lati ne sono consumatori sottili.
- **Eventi back-to-back**: seme per-evento + finestre orarie; l'intent di check-in include l'evento di registrazione e il server valida codice × finestra × registrazione.
- **Riuso ProxiMate**: le edge functions `generate-qr`/`verify-qr` (JWT a scadenza) sono il precedente del meccanismo; la demo adotta la derivazione a seme condiviso (più adatta all'offline della console) mantenendo la verifica server-side come unico giudice.

## Testing Decisions

- **Una sola cucitura: l'API di verifica.** Test black-box request/response sull'endpoint di consegna; nessun test attraverso UI, browser, o sync. La funzione di derivazione dei codici (seme+finestra → codice) è la stessa del server, usata come **fixture** nei test, non come seconda cucitura.
- **Un buon test** osserva solo comportamento esterno: dati in ingresso (codici, timestamp, evento, contesto) → check-in etichettato in uscita. Niente asserzioni su tabelle interne, ordine di chiamate o dettagli di storage.
- **Famiglie di scenari da coprire** (tutte sulla stessa porta):
  - codice valido nella finestra corrente/adiacente → provenienza "macchina";
  - codice scaduto, replay del medesimo codice, codice di altro evento/venue → respinti;
  - back-to-back: attribuzione all'evento di registrazione nella finestra giusta;
  - consegna in ritardo dentro/fuori finestra → accreditata per i minuti dei codici / respinta;
  - pochi codici in arco breve vs codici distribuiti → qualità bassa/alta (check-in-e-fuga visibile);
  - solo contesto GPS senza codici → provenienza "nessuno", mai accreditato;
  - spunta host → provenienza "umano";
  - tap sulla notifica → contribuisce alla qualità, mai alla provenienza.
- **Prior art**: nessuno (repo greenfield); i test di questa cucitura fanno da precedente per tutto il progetto.

## Out of Scope

- Advertising BLE nativo lato host (telefono dell'host come emettitore): lo copre l'ESP32 nella demo; nel documento resta descritto come opzione di prodotto.
- Rifacimento del client nello stack di WeRoad qualora fosse diverso da React Native: il plug-and-play è garantito dal contratto, i client consegnati sono implementazioni di riferimento.
- Testimonianza tra pari (BLE reciproco fra attendee): espansione futura, vedi `docs/espansioni-future.md`.
- Device attestation (Play Integrity / App Attest), biometria on-device/WebAuthn: citate nel documento come hardening, non implementate.
- Il testo del business case (documento di risposta al brief) e il montaggio del video: informati da questa spec, non parte della codebase.
- Autenticazione di produzione, GDPR hardening, gestione multi-tenant WeRoad.

## Further Notes

- **Tracciabilità al brief**: i tre requisiti letterali sono tutti presenti — geofencing (Arrivo + "crea evento demo qui"), notifica one-tap (invito in-page), QR (canale ottico del Codice Rotante, promosso da fallback a trasporto primario della demo). La tabella di tracciabilità va replicata in apertura del documento di risposta.
- **Posizionamento**: l'anchor fisico con challenge rotante è riconosciuto dall'industria come il livello più forte di proof-of-presence (precedente: Exposure Notifications per i token rotanti BLE; fact-check in background del 2026-08-04). Nei prodotti social resta non implementato perché lì la frode non paga; WeMeet ha venue e host collaborativi, che lo rendono praticabile.
- **Tesi del progetto** (da usare ovunque): *la posizione si dichiara, la prossimità si dimostra, la permanenza si conferma*.
- La demo web è il livello web del prodotto reale (graceful degradation), non un mock del nativo: va presentata così anche nel documento.
- **Gestione del rischio sui ~6 giorni rimasti**: il tier 1 (web + API di verifica) è il deliverable garantito e si completa per primo; il tier 2 (nativa) si costruisce sopra la stessa API. Linee di taglio dichiarate, in ordine: (1) se lo scanning BLE in Expo si impantana → l'app nativa consegna comunque geofence wake + push one-tap + cattura QR, e il canale radio si dimostra col precedente ProxiMate; (2) se anche il wake si impantana → il tier 2 esce dal consegnato e rientra nel documento. Il tier 1 non si sacrifica mai per il tier 2.
- **Clausola stack WeRoad — risolta il 2026-08-04**: stack comunicato (TypeScript ovunque; API Node+NestJS; frontend Vue+Nuxt; app RN+Expo) e adottato 1:1 in Turborepo. Il plug-and-play sale di livello: non solo contratto compatibile, ma moduli sollevabili direttamente (modulo NestJS nel loro backend, modulo Expo nella loro app, componenti Nuxt nel loro frontend).
