# CONTEXT — Glossario del dominio (check-in WeMeet)

Linguaggio condiviso del progetto. Solo termini di dominio, niente implementazione.

## Attori

- **Attendee** — iscritto a un WeMeet che deve risultare presente. Possiede un telefono personale (iOS o Android).
- **Host** — chi conduce l'evento sul posto (coordinatore WeRoad). Il suo device rappresenta il venue.
- **Venue** — il luogo fisico dell'evento. Può essere indoor (GPS inaffidabile).

## Concetti centrali

- **Beacon-notaio** — il *ruolo* di chi certifica tempo e luogo senza vedere nessuno: custodisce il seme dell'evento ed emette il Codice Rotante. Lo gioca il telefono dell'host (default: la console dell'evento, aperta comunque) o un dispositivo fisso al venue (ottimizzazione per i venue ricorrenti). Il seme è per-evento: la sua compromissione non eccede la fiducia già riposta nell'host di quell'evento.
- **Codice Rotante** — segreto effimero (≈30 s) derivato dal seme, conoscibile solo stando al venue in quel minuto. È una prova autodatante: il codice del minuto N prova il minuto N anche se consegnato ore dopo. Un solo codice, due canali:
  - **canale radio** — il codice trasmesso via BLE: il telefono lo sente da solo, indoor, in tasca.
  - **canale ottico** — lo stesso codice mostrato come QR (schermo dell'host): lo inquadri se il BLE non c'è. Uno screenshot inoltrato **non muore in 30 secondi**: muore solo se chi lo riceve mente sull'ora di raccolta (il codice è autodatante e la bugia non corrisponde a nessuna finestra). Dichiarando l'ora vera resta spendibile finché è aperta la **finestra di consegna** — vedi *Titolo al portatore*.
- **Testimonianza co-prodotta** — la prova di presenza: il beacon fa da notaio (ancora spazio-temporale), il telefono fa da sensore (raccoglie i codici e ne fa eco al server). Il beacon non può "vedere" i device (iOS in background è invisibile, i MAC ruotano): la direzione è telefono-ascolta, non beacon-guarda.
- **Check-in** — la presenza registrata di un attendee a un evento, etichettata su due assi ortogonali (non una scala):
  - **Provenienza** (chi conferma, discreta): **macchina** (codici consegnati e verificati), **umano** (l'host ha verificato la persona), **nessuno** (solo autodichiarazione del device, es. GPS). Macchina e umano non sono ordinate: la prima prova il *device*, la seconda la *persona*; il caso più forte le ha entrambe.
  - **Qualità** (quanto è solida, continua): quanti codici raccolti, la copertura (dwell), il buco più lungo fra due codici, il **ritardo di consegna**, il tap sulla notifica.
- **Testimonianza umana** — l'host dichiara di aver visto la persona. Entra da un **endpoint suo** (`POST /events/:id/attestations`), mai dal payload di una consegna: la consegna è ciò che l'attendee afferma di aver raccolto, la testimonianza è ciò che l'host afferma di aver visto, e farle passare dalla stessa porta lascerebbe che un borsellino si accrediti da solo la parola di qualcun altro. È anche da qui che nasce la riga di chi non ha mai consegnato niente (telefono scarico, nessuna app).
- **Titolo al portatore** — cosa *è* davvero un Codice Rotante, e quindi il limite onesto del modello. Un codice broadcast non è legato a chi lo riceve: chi ce l'ha lo spende. La provenienza `macchina` prova che **un codice emesso al venue in quel minuto è arrivato a questo account** — non che *quel* telefono fosse lì. Non è un difetto dell'implementazione ma la natura del broadcast: legarlo al device richiederebbe un dialogo domanda-e-risposta, che iOS non concede a schermo spento (vedi `docs/paradigma.md`).
- **Ritardo di consegna** — quanto era vecchia la prova più vecchia quando è arrivata al server. Il timbro d'arrivo lo mette il server alla prima consegna del codice: è l'unico istante della consegna che non arriva dal client. È la misura onesta della sola frode che il design non previene — chi è al venue consegna in diretta, chi riceve un codice inoltrato si porta dietro il ritardo. **Non separa il complice dall'attendee rimasto offline tutta la sera**: sono lo stesso fatto visto da qui. Mette la differenza in chiaro invece di lasciarla implicita.
- **Sessione di presenza** — l'intervallo fra l'ingresso e l'uscita dalla region del beacon. Un beacon non-connettibile non può accorgersi che te ne vai — non ti vede — ma il sistema operativo sì: `didExitRegion` è l'unico segnale di *fine presenza* disponibile, l'equivalente del disconnect BLE. La sessione **taglia** e non prova: il client non è fidato, quindi un'uscita dichiarata annulla l'intervallo che la contiene, ma nient'altro. Dichiarare una sessione lunga non allunga la copertura; **e nemmeno tacerla**.
- **Tetto per buco** — il massimo che si accredita fra due codici consecutivi (10 minuti). È ciò che rende la copertura misurabile senza fidarsi del client: chi si allontana un'ora si vede accreditare un tetto, dichiari o no l'uscita.
- **Dwell opportunistico** — la permanenza: la somma degli intervalli fra codici validi consecutivi, ciascuno accreditato fino al **tetto per buco**, e azzerato se una sessione dichiarata dice che in mezzo si è usciti. Non è campionamento continuo (iOS in background concede pochi secondi di ranging per risveglio): si accumula quando il telefono può ascoltare. Per questo è un **limite inferiore per costruzione** — si accredita il tempo intorno a ciò che si è sentito, mai quello che si immagina in mezzo — e si legge insieme al **buco massimo**. Attenzione a non sopravvalutarlo come difesa anti-relay: **il tetto taglia in tutte e due le direzioni**. Poiché fra due codici si accreditano al massimo 10 minuti, bastano ~13 codici inoltrati per costruire due ore di copertura — e possono essere girati in blocco a fine serata, non uno ogni 30 secondi. Ciò che il relay non può nascondere è il **ritardo di consegna**.
- **Buco massimo** — il tempo più lungo fra due codici consecutivi. Non prova un'assenza (anche chi resta ha buchi, quando il telefono dorme), ma è la differenza leggibile fra chi è rimasto e chi è uscito.
- **Testimonianza tra pari** *(espansione futura)* — i telefoni dei partecipanti si rilevano a vicenda via BLE e riportano gli incontri reciproci: le presenze si corroborano tra loro. Rafforza i gruppi e smaschera i presenti-solo-a-distanza (nessun pari li ha visti). Non nella prima versione: vedi `docs/espansioni-future.md`.

## Segnali di presenza

- **Dichiarazione di posizione** — segnale auto-riferito dal device (GPS/geofence). Economico, spoofabile da remoto. Avvia il flusso, non lo prova.
- **Prova di prossimità** — dimostrazione di aver ricevuto il Codice Rotante del venue. Non spoofabile da remoto: richiede presenza fisica (o un complice sul posto che inoltra codici per tutta la serata).
- **Arrivo** — l'ingresso rilevato dell'attendee nel geofence dell'evento; sveglia l'app in silenzio e apre la caccia ai codici. La notifica one-tap parte al primo contatto col beacon (quando «sei arrivato» è vero per costruzione); se il beacon resta muto, un paracadute temporizzato instrada sul canale ottico. L'arrivo NON è un check-in: è l'invito a produrne uno.

## Principi

- **Non valutare dichiarazioni: fatti testimoniare gli arrivi.** Il GPS non è una prova ma UX (sveglia l'app; la conferma la chiede solo il canale che sa dimostrarla, il beacon).
- **La porta della copertura non si chiude, si etichetta** — ogni design ha attendee non rilevabili automaticamente (telefono spento, permessi negati, niente app); i tentativi di chiuderla (biometria centralizzata, documento, niente fallback) costano più del male. Il fallback è il testimone umano, con la sua frode sociale dichiarata.
- **Frode commisurata all'incentivo** — battere il sistema deve richiedere un complice fisicamente presente; per un evento gratuito è un costo sproporzionato. Scoraggiare, non rendere impossibile.
- **Offline non è un caso d'errore** — la testimonianza può raggiungere il server da entrambi i lati (beacon-gateway o device), quando uno dei due ritrova la rete.
