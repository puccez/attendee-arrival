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
  - **canale ottico** — lo stesso codice mostrato come QR (schermo dell'host): lo inquadri se il BLE non c'è. Screenshot e inoltro muoiono per costruzione (scade in 30 s).
- **Testimonianza co-prodotta** — la prova di presenza: il beacon fa da notaio (ancora spazio-temporale), il telefono fa da sensore (raccoglie i codici e ne fa eco al server). Il beacon non può "vedere" i device (iOS in background è invisibile, i MAC ruotano): la direzione è telefono-ascolta, non beacon-guarda.
- **Check-in** — la presenza registrata di un attendee a un evento, etichettata su due assi ortogonali (non una scala):
  - **Provenienza** (chi conferma, discreta): **macchina** (codici consegnati e verificati), **umano** (l'host ha verificato la persona), **nessuno** (solo autodichiarazione del device, es. GPS). Macchina e umano non sono ordinate: la prima prova il *device*, la seconda la *persona*; il caso più forte le ha entrambe.
  - **Qualità** (quanto è solida, continua): quanti codici raccolti, la copertura (dwell), il buco più lungo fra due codici, il tap sulla notifica.
- **Sessione di presenza** — l'intervallo fra l'ingresso e l'uscita dalla region del beacon. Un beacon non-connettibile non può accorgersi che te ne vai — non ti vede — ma il sistema operativo sì: `didExitRegion` è l'unico segnale di *fine presenza* disponibile, l'equivalente del disconnect BLE. La sessione **delimita** e non prova: il client non è fidato, quindi ogni sessione vale i minuti dei codici validi che contiene, e dichiararla lunga non la allunga.
- **Dwell opportunistico** — la permanenza: somma delle sessioni di presenza, unite senza contare due volte le sovrapposizioni. Il tempo fra un'uscita e il rientro **non** entra — è ciò che rende visibile il check-in-e-fuga. Non è campionamento continuo (iOS in background concede pochi secondi di ranging per risveglio): si accumula quando il telefono può ascoltare. Senza sessioni dichiarate degrada all'arco fra il primo e l'ultimo codice, che è un limite superiore, non una permanenza — per questo si legge insieme al **buco massimo**. È anche la difesa principale anti-relay: inoltrare un codice costa un messaggio, inoltrarne per due ore costa un complice dedicato.
- **Buco massimo** — il tempo più lungo fra due codici consecutivi. Non prova un'assenza (anche chi resta ha buchi, quando il telefono dorme), ma è la differenza leggibile fra chi è rimasto e chi è uscito.
- **Testimonianza tra pari** *(espansione futura)* — i telefoni dei partecipanti si rilevano a vicenda via BLE e riportano gli incontri reciproci: le presenze si corroborano tra loro. Rafforza i gruppi e smaschera i presenti-solo-a-distanza (nessun pari li ha visti). Non nella prima versione: vedi `docs/espansioni-future.md`.

## Segnali di presenza

- **Dichiarazione di posizione** — segnale auto-riferito dal device (GPS/geofence). Economico, spoofabile da remoto. Avvia il flusso, non lo prova.
- **Prova di prossimità** — dimostrazione di aver ricevuto il Codice Rotante del venue. Non spoofabile da remoto: richiede presenza fisica (o un complice sul posto che inoltra codici per tutta la serata).
- **Arrivo** — l'ingresso rilevato dell'attendee nel geofence dell'evento; innesca la notifica one-tap. L'arrivo NON è un check-in: è l'invito a produrne uno.

## Principi

- **Non valutare dichiarazioni: fatti testimoniare gli arrivi.** Il GPS non è una prova ma UX (sveglia l'app, innesca la notifica one-tap).
- **La porta della copertura non si chiude, si etichetta** — ogni design ha attendee non rilevabili automaticamente (telefono spento, permessi negati, niente app); i tentativi di chiuderla (biometria centralizzata, documento, niente fallback) costano più del male. Il fallback è il testimone umano, con la sua frode sociale dichiarata.
- **Frode commisurata all'incentivo** — battere il sistema deve richiedere un complice fisicamente presente; per un evento gratuito è un costo sproporzionato. Scoraggiare, non rendere impossibile.
- **Offline non è un caso d'errore** — la testimonianza può raggiungere il server da entrambi i lati (beacon-gateway o device), quando uno dei due ritrova la rete.
