# Il notaio di riserva — chi emette il codice quando l'ESP32 non c'è

La domanda di fondo: WeRoad potrebbe non voler mai gestire hardware fisico da
distribuire ai venue. Il business case lo prevede già — §3.1: *default: il
telefono dell'host; ottimizzazione: un dispositivo fisso* — ma oggi quella
frase è vera solo per il canale ottico. La console web mostra il QR e basta:
**nessun browser può fare advertising BLE**, quindi la Fase 0 del rollout
(§11, «nessun hardware») oggi non ha canale radio. Questo documento chiude il
buco: chi può giocare il notaio radio senza hardware dedicato, cosa si
preserva e cosa si perde, quanto costerebbe il prodotto fisico, e se il BLE
resta la scelta giusta.

Un chiarimento che governa tutto: **il notaio è un ruolo, non un oggetto**
(CONTEXT.md). È definito da due capacità — custodire il seme dell'evento e
derivarne il Codice Rotante ogni 30 secondi — e da un formato di frame
(iBeacon, UUID fisso, codice in major/minor). Qualunque cosa sappia fare
queste due cose *è* il notaio, e il resto del sistema — verifica server-side,
etichette, borsellino, sandbox — non si accorge della differenza. Il fallback
non è un'architettura alternativa: è un altro attore nello stesso ruolo.

---

## 1. I candidati: cosa il venue ha già

| Chi | Può emettere il frame iBeacon? | In background? | Verdetto |
|---|---|---|---|
| **Telefono host Android** | Sì — `BluetoothLeAdvertiser` accetta manufacturer data arbitrari (0x004C) | **Sì**, con un foreground service: emette tutta la sera a schermo spento | **Il fallback vero.** Sostituto completo dell'ESP32 |
| **Telefono host iPhone** | Sì — `CBPeripheralManager` con i dati di `CLBeaconRegion` | **No**: iOS ferma l'advertising iBeacon appena l'app va in background | Sostituto **durante la finestra di check-in** (console aperta, telefono in carica). Il dwell serale degrada |
| **PC del locale — Windows** | Sì — `BluetoothLEAdvertisementPublisher` accetta manufacturer data | Sì (processo attivo) | Possibile con un piccolo agent. Ma quale bar ha un PC con BLE vicino alla sala? Nicchia |
| **PC del locale — Linux** | Sì — BlueZ emette advertising arbitrario | Sì | Come sopra |
| **Mac** | **No** — CoreBluetooth su macOS non accetta manufacturer data: niente frame iBeacon | — | Solo canale ottico |
| **POS** | In teoria sì: i POS «smart» (PAX, Sunmi, Verifone) sono Android con BLE | In teoria sì | **In pratica no**: la distribuzione app passa dai marketplace blindati dei vendor (PAXSTORE e simili), frammentati per acquirer, con vincoli PCI. Non è un canale su cui costruire |
| **Tablet/telefono Android dismesso, attaccato alla corrente** | Sì | Sì | Il «dispositivo fisso» senza hardware nuovo: ~€40-60 ricondizionato, e fa anche da gateway online. Alternativa concreta all'ESP32 per i venue ricorrenti |
| **ESP32 (quello che abbiamo)** | Sì | Sì, sempre | L'ottimizzazione: sempre acceso, €15, zero manutenzione. Ma resta un'ottimizzazione |

La riga che conta è la prima. **Il coordinatore WeRoad è per definizione
all'evento, con un telefono.** I WeMeet girano per bar sempre diversi — è
proprio il motivo per cui una flotta di hardware fisso è la risposta sbagliata
come *prerequisito*: non puoi installare un beacon in ogni locale che ospita
un aperitivo una volta. Il telefono dell'host viaggia da solo.

## 2. La modalità notaio nell'app host

Cosa serve per rendere vera la Fase 0 anche sul canale radio: una **modalità
notaio** nell'app (o una mini-app host dedicata).

- **Il seme scende una volta.** L'app host riceve il seme alla creazione (o
  con il token dell'host — è la porta già discussa in §9.2: «il notaio riceve
  il seme una volta e deriva in locale»). Da lì deriva i codici offline: la
  rete del locale può morire, l'emissione no.
- **Android**: foreground service + `BluetoothLeAdvertiser`, stesso frame di
  `firmware/attendee_beacon/ibeacon_frame.c` (i test di parità coprono già la
  derivazione; il layout del frame è condiviso). Emette a schermo spento per
  tutta la serata. Consumo: pochi punti percentuali di batteria a serata —
  l'advertising è l'operazione BLE più economica che esista.
- **iPhone**: `CBPeripheralManager` in foreground, idle timer disattivato,
  telefono in carica dietro al bancone con la console a schermo — che è
  esattamente come la console viene già usata. Quando l'app va in background
  l'emissione si ferma: iOS non concede advertising iBeacon in background,
  punto. Non è aggirabile ed è dichiarato.
- **Il battito in dashboard resta**: un notaio che muore (host che se ne va
  col telefono in tasca, app chiusa) deve essere rumoroso. La dashboard già
  mostra il battito del beacon; la modalità notaio lo alimenta uguale.

**Cosa si preserva, vincolo per vincolo:**

| Vincolo del sistema | Con la modalità notaio |
|---|---|
| Codice Rotante autodatante, HMAC dal seme | Identico: stessa derivazione, stessa finestra |
| Sveglia iOS in background (lato attendee) | Identica: stesso UUID di prossimità, l'attendee non sa chi emette |
| Il beacon non vede nessuno (privacy) | Identico: l'advertising è unidirezionale chiunque lo emetta |
| Offline del venue | **Migliora** rispetto alla console web attuale: derivazione locale |
| Seme per-evento, nessuna chiave globale | Identico |
| Battito del notaio in dashboard | Identico |

**Cosa cambia, dichiarato:** l'affidabilità dell'emissione dipende dal
telefono dell'host (batteria, host che si allontana). Su iPhone il canale
radio copre bene l'arrivo e peggio il dwell serale — che torna a poggiare su
ri-scansioni del QR e sui campioni opportunistici. È un degrado, non un
crollo: la struttura delle etichette lo assorbe (meno copertura misurata,
stessa provenienza).

**Stima di lavoro:** 2-4 giorni. Android advertising + foreground service
(1-2), iOS foreground advertising (1), porta del seme per l'host (0.5-1),
riuso dei test di parità esistenti.

## 3. La rete peer-to-peer: perché non può essere il fondamento

La domanda: si può fare tutto senza notaio, con i telefoni che si vedono a
vicenda via BLE, «da soli, sempre in background»?

**No, per due ragioni indipendenti — una di piattaforma, una di fiducia.**

**Piattaforma.** Su iOS un'app in background non può emettere iBeacon (si
ferma), e l'advertising di servizio finisce nella *overflow area*: leggibile
solo da dispositivi Apple che scansionano esplicitamente quel service UUID, e
la scoperta **background↔background fra due iPhone è inaffidabile** — è il
risultato, documentato in tutta l'era del contact tracing, per cui serviva un
Android da ponte o uno schermo acceso. Apple e Google le Exposure
Notifications le hanno costruite *dentro il sistema operativo* proprio perché
alle app di terze parti questo non è concesso. Un aperitivo è pieno di iPhone
in tasca: la rete che «si tesse da sola in background» su quella platea non
si tesse.

**Fiducia.** I pari sono testimoni interessati. Senza un'ancora al venue,
quattro complici sul divano si corroborano a vicenda: la rete attesterebbe
gruppi, non luoghi. Il Codice Rotante risolve esattamente questo — il seme
sta *al venue* — e la critica del titolo al portatore si applica ai pari due
volte (un avvistamento riferito è una dichiarazione del dichiarante).

**Cosa resta buono del P2P** — ed è già in §12 e
`docs/espansioni-future.md`: la **testimonianza tra pari come corroborazione**.
Gli incontri si raccolgono quando le app sono in foreground (a un aperitivo i
telefoni si accendono di continuo) e ogni Android presente fa da ponte. Non
fonda la presenza: la *rafforza*, e soprattutto smaschera il complice remoto —
chi consegna codici inoltrati e non è stato visto da nessun pari ha un buco
visibile nel dato. Arricchimento, con consenso dedicato. Non fondamento.

## 4. Il BLE è la scelta giusta?

Il requisito che stringe è uno: **raccogliere la prova col telefono in tasca,
senza gesti, indoor, su iOS**. Contro quello, le alternative:

| Canale | Sveglia iOS in background | Zero gesti | Indoor | Dwell | Nota |
|---|---|---|---|---|---|
| **BLE iBeacon** | **Sì** (region monitoring) | **Sì** | Sì | Opportunistico | L'unico che soddisfa il vincolo che stringe |
| QR (ottico) | No | No (inquadri) | Sì | A ri-scansioni | Già canale di prima classe |
| GPS/geofence | Sì | Sì | **No** | No | Dichiarazione, mai prova — premessa del brief |
| WiFi del locale | No (iOS non espone scansioni) | No | Sì | No | Resta buono come segnale §6.6 (BSSID), non come canale |
| NFC statico | Sì (tag reading da Xs in su) | No (tocchi) | Sì | A tocchi | Tag statico = titolo al portatore fotografabile e replayabile all'infinito |
| **NFC dinamico (NTAG 424 DNA)** | Sì | No (tocchi) | Sì | A tocchi | Interessante: ~€2 a sticker, codice diverso a ogni tocco (contatore+CMAC), verificabile server-side senza app. È un **QR di ceramica**: canale ottico migliore, non un canale radio |
| Ultrasuoni | No (mic in background negato) | — | Sì | — | No |
| UWB | No (foreground) | No | Sì | Sì, metrico | §12: terzo canale futuro, anti-relay nativo, ancora poco diffuso |

Conclusione onesta: il BLE non è «il migliore in assoluto» — è **l'unico
trasporto che il vincolo iOS-in-tasca lascia in piedi**. E la forza del
design è che non sposa il trasporto: il Codice Rotante è lo stesso su QR, BLE,
NFC dinamico o UWB. Se fra tre anni l'UWB è ovunque, è un canale in più dello
stesso segreto, non una migrazione.

## 5. Quanto costa il prodotto fisico

Stime, dichiarate come tali (agosto 2026, quantità indicative):

**Pilota (10-100 venue ricorrenti)** — devkit ESP32-C6 (€6-12) + alimentatore
USB-C (€4-6) + case stampato (€2-4): **€15-22 a pezzo**, zero costi di
avviamento, provisioning in un minuto da seriale. È quello che c'è in
`firmware/` — già compilato, flashato e verificato in parità col server.

**Produzione (≥1.000 pezzi)** — PCB custom con modulo pre-certificato
ESP32-C6-MINI-1 (€2-2.5) + assemblaggio (€2-3) + alimentazione (€1-1.5) +
case (€1.5-3) + flash/test/confezione (€1-1.5): **BOM €8-11**. Una tantum:
design PCB (€2-5k), stampo case se custom (€4-8k, evitabile con case a
catalogo), EMC/CE con modulo radio già certificato (€3-6k). Programma
completo ≈ **€18-30k per la prima serie da mille** (€18-30/pezzo), poi
€10-14/pezzo.

**Variante a batteria** — su nRF52 invece che ESP32: stesso BOM circa, mesi
di autonomia a coin cell, niente presa da chiedere al locale. È la strada se
il «fisso al venue» diventa davvero prodotto.

**Il confronto che decide** — un Android ricondizionato attaccato alla
corrente fa il notaio *e* il gateway per €40-60, zero NRE, zero
certificazioni. Sotto le poche centinaia di pezzi, l'hardware custom non si
ripaga.

**La conclusione strategica**: l'hardware non è il prodotto e non è il moat —
è un'ottimizzazione comprabile in qualunque momento, per i venue che
ricorrono (uffici WeRoad, locali partner). Il prodotto è il protocollo: seme
per-evento, codice autodatante, verifica server-side, etichette. Tutto ciò
che serve per convincere WeMeet sta in una frase: **si parte con zero
hardware** (modalità notaio nell'app host, §2), **e ogni euro di hardware
dopo è un upgrade di comodità, mai un prerequisito.**

---

## 6. Eventi all'aperto e itineranti: il luogo è il notaio

Non tutti i WeMeet stanno in un locale: passeggiate, parchi, ambienti che si
muovono. Il salto concettuale è uno: per un evento itinerante **il «venue»
smette di essere una coordinata e diventa il notaio stesso**. La prova non è
mai stata «ero alle coordinate X» — è «ho sentito il codice che esisteva solo
vicino al seme, in quel minuto». All'aperto questo diventa letterale:

- **L'ancora cammina con l'host** (modalità notaio, §2): la bolla BLE —
  20-50 m all'aperto, meglio che indoor — si muove col gruppo. Presenza =
  essere *col gruppo*, che per una passeggiata è la semantica giusta.
- **Il geofence del brief cambia trigger, non muore**: per l'evento fisso
  resta il cerchio GPS; per l'itinerante **la region iBeacon è il geofence
  mobile** — iOS sveglia l'app all'ingresso in region anche da uccisa, e la
  region sta dovunque stia il notaio. Il ritardatario che raggiunge il gruppo
  a metà percorso viene svegliato *dal gruppo stesso*. La notifica one-tap
  scatta uguale, con lo stesso dedup sulla transizione.
- **L'uscita è simmetrica e gratuita**: se il gruppo se ne va e tu resti al
  chiosco, è l'evento che esce da te — `didExitRegion`, sessione tagliata.
- **Gruppo disperso → più notai, zero protocollo**: il seme è per-evento e la
  derivazione deterministica, quindi **due telefoni con lo stesso seme
  emettono lo stesso codice**. Co-host su due campi = due emettitori; il
  server non se ne accorge. Hardening quando serve: sub-semi per-notaio via
  HKDF (revocabili singolarmente) o a scadenza temporale — *scopare* il
  segreto, non «criptarlo di più».
- **Il GPS all'aperto torna forte — come contesto** (§6.6 del business case):
  l'accuratezza migliora, la custodia no. Mock location funziona anche su un
  prato, e un percorso pubblicato rende banale lo spoof da casa. Resta
  contesto, mai prova: l'anti-frode del brief non cambia di un millimetro.
- **I costi dichiarati**: batteria dell'host (powerbank), niente prese
  (variante nRF52 a batteria, §5), sole sul QR di giorno, e il dwell
  opportunistico iOS — identico a indoor.

## 7. Cosa insegnano gli altri

**ProxiMate** (FirstLayer, il precedente citato nello Swift del modulo): P2P
puro — ogni utente advertisa un service UUID personale, scansiona gli amici,
si connette in GATT e campiona l'RSSI, con i *restoration identifier* che
fanno rilanciare l'app per gli eventi BLE in background. Due lezioni. La
prima: il P2P fra sconosciuti in background su iOS è la battaglia più dura
della piattaforma — è l'esperienza empirica dietro «la rete tra pari non si
tesse da sola» (§3). La seconda, più sottile: **le pending connection con
restoration funzionano** — iOS completa una connessione GATT in background
verso un peripheral noto e rilancia l'app. Quindi il canale domanda-e-risposta
*esiste*: un ESP32 connettibile + pending connect + challenge per-device
chiuderebbe il titolo al portatore. Non è il default per ragioni di capacità
(pochi slot GATT simultanei contro decine di attendee), batteria e
affidabilità — ma è il gradino di hardening sopra il broadcast, quando il
valore in gioco lo giustifica.

**Bump (Amo)** — il «sai quando un amico è vicino, in background»: sotto è
**posizione in background, non BLE** (l'app Android si chiama letteralmente
`co.amo.android.location`), con matching server-side. La lezione: i consumer
che vogliono il *sempre-in-background* rinunciano al BLE P2P e ripiegano sul
GPS — che per loro basta, perché il problema di Bump è la scoperta, non la
prova. Il nostro è la prova: la posizione è una dichiarazione, e il brief
chiede esattamente di non fidarsene.

**I sistemi di presenza accademici su BLE** sono convergenti sulla nostra
identica architettura — il telefono del docente come unico beacon, identificatore
di sessione rotante, scansione passiva degli studenti, validazione sul
backend — e la letteratura d'attacco canonica è la *signal imitation* (il
nostro inoltro del titolo al portatore), con biometria on-device come
contromisura di fascia alta. Non è un'idea esotica: è lo stato della pratica,
col vantaggio che noi il limite lo dichiariamo e lo misuriamo (ritardo di
consegna) invece di fingerlo risolto.

---

## In una frase

Il notaio è chi custodisce il seme, non il silicio che lo ospita: il telefono
che l'host ha già in mano è il fallback, la bolla che cammina col gruppo è il
venue degli eventi itineranti — e l'ESP32 resta quello che è sempre stato
sulla carta, un'ottimizzazione.
