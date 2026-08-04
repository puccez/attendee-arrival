# Perché un codice gridato a tutti, e non una domanda fatta a te

> Materiale per il documento (traccia A). Nasce da una domanda che si fa
> chiunque guardi il meccanismo con occhio tecnico: *«perché non un
> challenge-response?»*. Il documento oggi non risponde. Dovrebbe: è
> probabilmente la prima obiezione di un valutatore competente, e la risposta
> è buona.
>
> Registro volutamente piano: ogni termine tecnico va spiegato la prima volta
> che compare. Chi legge il business case non è detto che conosca il BLE.

---

## Le due forme di prova

### La forma che ci si aspetta: **domanda-e-risposta**

In gergo si chiama *challenge-response*, e la catena tipica è:

```
il server inventa una domanda → il beacon del locale la riceve
  → risponde mettendoci un sigillo che solo lui sa produrre
  → la risposta torna indietro attraverso l'app → il server la verifica
```

La forza sta tutta in una parola: la domanda è **nuova**. Usa-e-getta. Una
risposta di ieri non vale oggi, e una risposta preparata per me non vale per
te. È il modo in cui funziona il badge dell'ufficio, la chiave dell'auto, il
lettore NFC del tornello.

### La forma che abbiamo scelto: **un codice a tempo, trasmesso a tutti**

```
il server e il beacon si scambiano un seme segreto, una volta sola
  → ogni 30 secondi il beacon calcola 6 cifre dal seme più l'orario corrente
  → le trasmette via radio a chiunque sia nel raggio. Non aspetta risposta.
    Non sa chi lo sta ascoltando
  → il telefono le sente e se le mette in tasca
  → più tardi le consegna al server
  → il server rifà lo stesso identico conto e verifica che tornino
```

È esattamente il meccanismo del codice a sei cifre dell'app della banca, o di
Google Authenticator: un numero che cambia da solo ogni mezzo minuto perché è
calcolato dal segreto e dall'orologio, e che quindi **si data da sé**. La
differenza è che il nostro, invece di comparire sul tuo schermo, viene gridato
a tutta la stanza.

Non c'è nessuna domanda. La domanda è il minuto in corso.

---

## Il confronto, riga per riga

| | domanda-e-risposta | il nostro codice a tempo |
|---|---|---|
| la domanda | nuova, e fatta apposta per te | non c'è: è il minuto in corso |
| il dialogo | telefono e beacon si parlano | il beacon parla, nessuno risponde |
| **è legato al tuo telefono?** | **sì** — la domanda era tua | **no** — chi sente le cifre le può usare |
| telefono in tasca, schermo spento | non funziona | **funziona** |
| 40 persone insieme | si collegano una alla volta, si fa la fila | tutte insieme, senza costo |
| privacy | il beacon vede i telefoni che si collegano | il beacon non vede nessuno |

Le due righe in grassetto sono il baricentro di tutta la scelta.

---

## Perché non possiamo dialogare

Non è una preferenza estetica: è un vincolo del sistema operativo.

Un iPhone con lo schermo spento e l'app chiusa **non può mettersi a
chiacchierare via Bluetooth** con un dispositivo qualsiasi. iOS non lo
permette. L'unica cosa che concede a un'app addormentata è di **svegliarsi
quando sente un beacon** nelle vicinanze — la stessa primitiva che fa
comparire la carta d'imbarco quando arrivi in aeroporto. Sentire sì,
rispondere no.

Su quella singola possibilità sta in piedi tutto il resto del design: la
notifica che arriva senza che tu tocchi niente, la permanenza che si accumula
col telefono in tasca, il fatto che il sistema funzioni per chi si dimentica di
aprire l'app — cioè quasi tutti.

E poi c'è il numero. Un ESP32 regge una manciata di collegamenti Bluetooth
simultanei. A un aperitivo con quaranta persone che arrivano nello stesso
quarto d'ora, un beacon che deve dialogare uno alla volta diventa una coda; un
beacon che trasmette e basta serve un numero illimitato di persone senza
accorgersi di nessuna.

**Quindi il broadcast non è la versione scarsa del dialogo. È l'unica che
sopravvive al vincolo.**

Precedente citabile: le Exposure Notifications di Apple e Google — il
tracciamento dei contatti del 2020, su scala planetaria — usano la stessa forma
per la stessa ragione.

---

## Cosa paghiamo

Va detto senza girarci intorno: **le sei cifre non sono legate a nessun
telefono in particolare**. Un amico al locale te le manda su WhatsApp e tu le
usi da dieci chilometri, purché entro il mezzo minuto in cui valgono.

Contro questo il sistema non oppone matematica, oppone **economia**: inoltrare
*un* codice costa un messaggio; farsi accreditare una serata intera richiede un
complice che passi la serata a fare da ponte, codice dopo codice. Per un
aperitivo gratuito è un prezzo assurdo. È una difesa dichiarata come tale — non
"impossibile", ma "non conviene" — ed è anche il motivo per cui la permanenza
conta quanto la presenza.

---

## Dove il dialogo rientra: il beacon che sa fare tutte e due le cose

Non al posto del broadcast: **accanto**.

Il beacon continua a gridare le sue sei cifre a tutti, per il risveglio
automatico e per la permanenza. In più apre un canale di dialogo che si usa
**una volta sola: quando l'attendee tocca la notifica**. In quel preciso
momento l'app è aperta e in primo piano — il vincolo di iOS non c'è più, perché
il vincolo riguarda le app addormentate.

E allora:

1. tocchi la notifica, l'app si collega al beacon
2. il beacon inventa una domanda nuova, mai usata prima
3. il telefono la firma con una chiave che vive dentro un chip sigillato
   dell'iPhone (il *Secure Enclave*): una chiave diversa per ogni telefono, che
   non può uscire da lì nemmeno se il telefono viene manomesso
4. il beacon a sua volta firma «ho parlato con questo telefono, a quest'ora»
5. l'app porta entrambe le firme al server

Adesso l'amico a dieci chilometri non può fare niente: non ha il tuo chip,
quindi non sa produrre la tua firma; e la domanda era nuova, quindi non può
riusarne una vecchia.

Il risultato è la combinazione migliore: **rilevamento automatico per tutta la
serata** dal canale che grida, e **una prova legata al tuo telefono** nel
momento che conta. È lavoro di firmware più codice Swift — uno o due giorni —
e non è in questa consegna.

La formula da usare nel documento: alla domanda *«perché non un
challenge-response?»* la risposta non è «non serve», è **«serve dove una
connessione c'è, e per il 99% della serata una connessione non c'è»**.

---

## La scala dei rinforzi, in ordine di convenienza

1. **Tetto sugli intervalli** *(fatto)* — fra due codici consecutivi si
   accreditano al massimo 10 minuti. Toglie di mezzo l'unico punto in cui il
   server doveva credere al telefono sulla parola. Vedi
   `packages/core/src/verification.ts`.
2. **Far certificare ad Apple e Google che l'app è quella vera** — si chiamano
   App Attest e Play Integrity. Non dicono dove sei: dicono che l'app che sta
   parlando col server è la nostra, originale, su un telefono non manomesso, e
   non un programma scritto da qualcuno per fingersi lei.
3. **FaceID sul tap** — oggi la difesa contro «l'amico che tocca conferma al
   posto tuo» è che quel tap da solo non produce niente. Ottima risposta, ma
   lascia il tap senza valore. Se per confermare serve il tuo volto, il tap
   diventa un segnale sulla **persona** — l'asse dove siamo più scoperti,
   perché tutto il resto prova dov'era il *telefono*.
4. **Il beacon dual-mode** — la sezione qui sopra.
