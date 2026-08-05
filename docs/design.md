# Il linguaggio visivo: come si veste questa demo

Questo documento non è un moodboard. È l'insieme di regole che rendono la demo
riconoscibile come **una cosa di WeRoad** invece che come il progetto di
qualcuno che ha letto il brief.

---

## 0. Da dove vengono questi numeri

Non sono a occhio, e le due fonti hanno affidabilità diversa — vale la pena
dirlo perché cambia quanto ci si può appoggiare a ciascun numero.

**Il web** (`weroad.it`, `/wemeet/eventi`, una pagina di dettaglio evento): ho
letto gli **stili calcolati dal browser**. Colori effettivamente dipinti,
dimensioni, pesi, raggi, spaziature. Questi numeri sono esatti.

**L'app** (cinque screenshot da iPhone, 1179×2556 @3x): i **colori sono
campionati dai pixel** — esatti. La **geometria è misurata sull'immagine**:
margine e raggio delle card li ho ricavati contando i pixel del bordo, le
dimensioni dei caratteri sono stimate. Quindi: colori affidabili, geometria
buona, tipografia approssimata.

Dove scrivo un valore dell'app, è in **punti** (schermo da 393pt).

Gli screenshot sono in `docs/riferimenti/` — con i volti dei partecipanti
sfocati, perché erano persone reali e questo repository è collegato dal
business case. Il perché sta in `docs/riferimenti/README.md`.

---

## 1. Un brand, due sistemi

La scoperta che conta: **il web e l'app non si somigliano.**

| | Web | App |
|---|---|---|
| Fondo | Bianco `#ffffff` | **Sabbia calda** `#efe9e2` → `#f6f3ef`, con trama a onde diagonali |
| Card | Bordo 1px `#e5e5e5`, raggio 16px | **Nessun bordo**, raggio 16pt, bianche sulla sabbia |
| Pastiglie | Raggio 6px | **Completamente arrotondate** |
| Stato attivo | — | **Nero** `#171717` |
| Avatar | Cerchi | **Quadrati arrotondati** |
| Icone | Outline grigie | Outline in **tessere colorate per categoria** |

Il web è **sobrio e squadrato**: bianco, bordi sottili, angoli contenuti. È un
catalogo.

L'app è **calda e morbida**: fondo sabbia, card bianche che galleggiano senza
bordo, tutto completamente arrotondato, tessere di colore per categoria. È un
posto dove si incontrano persone.

**Quello che le tiene insieme è una cosa sola**: il rosso corallo `#ff4758`,
identico nei due — l'ho campionato in entrambi. Più i grigi neutri e il tono di
voce.

> Questa differenza non è un dettaglio di stile: è la ragione per cui la nostra
> vista attendee deve seguire **l'app**, non il sito. Vedi §8.

---

## 2. Colore

### Il brand — vale ovunque

| Ruolo | Valore |
|---|---|
| **Brand** | `#ff4758` |
| Brand disabilitato | `#ffa2aa` |
| Titoli / stato attivo | `#171717` |
| Testo forte | `#262626` |
| Testo | `#404040` |
| Testo secondario | `#525252` · `#616161` |
| Testo tenue | `#a3a3a3` · `#737373` |

Il rosso è **corallo, non arancione**: tira al rosa. La demo oggi usa
`#e1502e`, un arancio bruciato — sbagliato, e si nota accostandoli.

I grigi sono la scala `neutral` di Tailwind. Adottarla ci fa combaciare senza
sforzo.

> **Il rosso è solo per agire.** Se una superficie è rossa, ci si clicca — o è
> la voce attiva della barra in basso. Un titolo rosso «decorativo» rompe la
> convenzione più visibile del brand.

### Web

| Ruolo | Valore |
|---|---|
| Superficie | `#ffffff` |
| Superficie incassata | `#f5f5f5` |
| Linee | `#e5e5e5` |
| Teal | `#418089` · scuro `#2f7580` · tinta `#f2f9f9` |
| Verde | `#16a34a` |
| Giallo (badge pieno) | `#eab308`, testo bianco |

### App

| Ruolo | Valore |
|---|---|
| Fondo | gradiente `#efe9e2` → `#f6f3ef` + trama diagonale |
| Card | `#ffffff`, senza bordo |
| Tessera icona informativa | fondo `#dfe8e9`, icona `#262626` |
| Tag (tipo «Gita fuoriporta») | fondo `#ddeff0`, testo `#2d454c` |
| Pastiglia di stato | fondo `#f5f5f5`, testo `#737373` |
| Pastiglia di stato su foto | fondo `#ffffff`, testo `#262626` |
| Barra in basso | bianca; attivo `#ff4758`, inattivo `#616161` |

**Tessere di categoria**: ogni categoria ha una sua tinta pastello con l'icona
in un tono saturo della stessa famiglia. Osservate: crema `#fff6dd` + icona
`#a85b48` (beach volley), azzurro `#e7f2ff` + icona `#5a60d1` (barca), azzurro
chiaro `#e3f2fe` + icona `#1a86c3` (drink). Non è una palette fissa: è una
**regola** — tinta chiarissima, icona satura, stessa famiglia cromatica.

---

## 3. Tipografia

Il web usa **Google Sans** (variabile, auto-ospitato). Stack dichiarato:
`"Google Sans", sans-serif`. L'app usa lo stesso carattere, o qualcosa di
indistinguibile.

Scala misurata sul web, desktop:

| Livello | Dimensione / interlinea | Peso | Colore |
|---|---|---|---|
| Titolo pagina | 48 / 48 | 700 | `#171717` |
| Sezione | 36 / 40 | 700 | `#262626` |
| Sottosezione | 24 / 32 | 600 | inherit |
| Corpo | 16 / 24 | 400 | `#404040` |
| Titolo di card | 16 / 24 | 600 | `#262626` |
| Piccolo | 14 / 20 | 400 | `#525252` |
| Micro (pastiglie) | 12 / 16 | 500 | `#262626` |

Due regole che si vedono subito: **mai spaziatura fra lettere**, e **interlinea
1.0 sui titoli**. Un titolo grande con interlinea larga è il modo più rapido
per non somigliargli.

Nell'app la scala è **più grande e più contrastata**: il titolo di un evento in
lista arriva a ~24pt in grassetto contro un corpo di ~15pt, e il titolo sulla
foto di dettaglio a ~32pt. Le intestazioni di giorno («Lunedì, 3 agosto») sono
in grassetto quasi quanto i titoli. *(Stimato.)*

### Sul font, una nota onesta

Google Sans è proprietario. WeRoad lo ospita perché presumibilmente ha titolo
per farlo; **noi no**, e ridistribuirlo in una demo pubblica non è una cosa da
fare per un business case.

Quindi: lo dichiariamo in testa allo stack — chi ha un dispositivo che ce l'ha
lo vede giusto — e dietro mettiamo un'alternativa aperta con la stessa
personalità (geometrica, umanista, occhio medio alto). **Figtree** è la più
vicina; Inter va bene ed è ovunque.

```css
font-family: "Google Sans", Figtree, Inter, system-ui, sans-serif;
```

È anche una riga che vale la pena dire ad alta voce: sappiamo cos'è un font
sotto licenza.

---

## 4. Forma

### Web

| Raggio | Dove |
|---|---|
| `6px` | Bottoni, pastiglie, badge, voci di menu, campi |
| `16px` | Card di lista |
| `32px` | Pannelli grandi, immagine hero |
| `9999px` | Avatar |

Bordi sempre `1px solid #e5e5e5`. **Ombre: nessuna.** In tutta la superficie
campionata il `box-shadow` è `none`; le superfici si staccano con bordo e
raggio.

### App

| Valore | Dove |
|---|---|
| **16pt** | Card (misurato: curva completa in 16pt, angolo continuo iOS) |
| ~18pt | Tessere icona quadrate |
| completamente arrotondato | Pastiglie, filtri, chip, bottoni, barra d'azione |
| ~14pt | Avatar (quadrati arrotondati, non cerchi) |

**Margine laterale: 16pt** (misurato: card larghe 361pt su schermo da 393pt).

**Nessun bordo.** Le card bianche si staccano per contrasto con la sabbia, non
per una linea. È lo stesso principio del web — separare senza disegnare — con
un mezzo diverso.

---

## 5. Componenti — web

**Bottone primario**: `#ff4758`, testo bianco, 16px/500, raggio 6px, padding
0 16px, altezza ~48px, nessuna ombra.
**Secondario**: bianco, `1px solid #e5e5e5`, testo `#404040`.
**Pastiglia**: 12px/500, raggio 6px, padding 4px 8px, bordo `#e5e5e5`, fondo
trasparente.
**Card di lista**: raggio 16px, bordo 1px, padding 16px. Riga meta (calendario
· data · giorno | orologio · ora) → titolo 16/600 → riga luogo (pin · indirizzo
| distanza) → pastiglie → pila di avatar. Miniatura quadrata a destra.
**Pannello**: raggio 32px.
Separatore fra campi meta: `‧` (U+2027), non il punto elenco.

---

## 6. Componenti — app

**Testata**: saluto in due righe con il luogo **sottolineato e toccabile**
(«Ciao Emanuele, incontra persone a *Milano, LOM, Italia*»), e un bottone
circolare bianco con il pin a destra. Nessuna barra di navigazione: il
contenuto comincia dalla sabbia.

**Chip di periodo**: fila scorrevole orizzontalmente. Attivo = **pastiglia nera
`#171717` con testo bianco**; inattivi = solo testo `#404040`, senza contenitore.
È il pattern più caratteristico dell'app, e non usa il rosso.

**Intestazione di giorno**: «Lunedì, 3 agosto», grassetto, sopra il gruppo di
card. Le liste sono raggruppate per giorno, non piatte.

**Card di categoria** (home): tessera icona quadrata tinta a sinistra, titolo in
grassetto, sottotitolo «1 evento · Alle 19:30». Espandendola compare **dentro**
la card di evento vera.

**Card di evento** (scopri): riga meta con icone outline (calendario + data |
orologio + ora) → titolo grande in grassetto → pin + indirizzo · distanza →
eventuale tag colorato → **riga avatar** (quadrati arrotondati sovrapposti +
tessera scura `+N`) + «16 partecipanti» + pastiglia di stato a destra.
Miniatura in alto a destra, raggio ~16pt.

**Stato esaurito**: la card intera va **in grigio desaturato**, con la pastiglia
«Sold Out» accanto al titolo. Non si nasconde e non si toglie: si spegne.

**Dettaglio evento**: foto a tutto schermo senza barra, con chevron indietro e
condividi **appoggiati sopra**; pastiglia di stato bianca e titolo bianco grande
in basso sulla foto; poi una **card bianca che risale sopra la foto** con le
righe informative — tessera icona `#dfe8e9`, riga in grassetto, sottoriga grigia,
chevron se si può toccare (l'indirizzo apre le mappe). Sotto: «16 partecipanti»
con la fila di avatar. In fondo, **barra d'azione fissa a pastiglia
galleggiante**: etichetta di stato a sinistra, bottone primario a destra.

**Barra di navigazione**: cinque voci, fondo bianco, icone outline, etichetta
~13pt. Attiva in `#ff4758`, inattiva `#616161`.

**Emoji come icone**: nelle righe di suggerimento («📅 Che ne dici di un
weekend?»). Informale, e da usare con parsimonia.

---

## 7. Microcopy

Le regole si leggono dalle loro frasi:

- **Dai del tu.** «Scopri», «Conosci», «Trova il viaggio».
- **Chiama per nome.** «Ciao Emanuele, incontra persone a Milano».
- **Domanda come titolo.** «Pronto a fare nuove amicizie?» «Chi c'è? (16)»
  «Che ne dici di un weekend?»
- **Rassicura invece di scusarti.** «Ma niente panico: ce ne sono tanti altri!»
- **Frasi corte, punto fermo.** «Scopri il mondo. Conosci nuovi amici.»
- Zero gergo, zero passivo, zero «la piattaforma consente di».

Per noi c'è una tensione da nominare: il nostro prodotto parla di **prove,
frodi e verifiche**, che è un registro freddo. La regola: **l'attendee non deve
mai leggere il vocabolario della verifica.** Vede «Ci sei» e i minuti al
WeMeet, non «provenienza: machine». Quel vocabolario vive nella console
dell'host e nella sandbox, dove è esattamente ciò che vogliamo mostrare.

---

## 8. Come si applica alle nostre tre superfici

Qui sta la decisione che vale la pena prendere consapevolmente.

### Vista attendee → segue **l'app**

È mobile, è la superficie dell'attendee, ed è l'unica che girerà davvero da
telefono. Deve avere il fondo sabbia, le card bianche senza bordo, le pastiglie
completamente arrotondate, e la barra d'azione fissa in basso.

La struttura del dettaglio evento dell'app è **quasi esattamente quella che ci
serve**, e non è una coincidenza — è la stessa informazione:

| Loro | Noi |
|---|---|
| Foto a tutto schermo, titolo bianco sopra | Nome dell'evento |
| Card che risale con data e luogo | Data, luogo, e **da quanto sei qui** |
| «16 partecipanti» + avatar | Chi altro è arrivato |
| Barra fissa: stato + bottone | **«Ci sei» / «Confermo, sono qui»** |

Quella barra fissa in basso è il posto naturale per la conferma one-tap, ed è
un posto che l'app usa già per l'azione principale.

### Console host → segue **il web**

È desktop, è uno strumento di lavoro, deve reggere una tabella densa. Bianco,
bordi da un pixel, raggio 16px, niente sabbia. Qui il vocabolario tecnico ci
sta: è lo strumento di chi deve capire.

Da rubare comunque: la **riga meta con le icone**, e la **pila di avatar** al
posto di una colonna di nomi dove ha senso.

### Sandbox d'attacco → **si allontana di proposito**

Deve sembrare un laboratorio, non una pagina di prodotto: monospaziato per i
codici, esiti che si distinguono a colpo d'occhio. Un attacco che sembra un
bottone di marketing non si legge come attacco. Resta il rosso del brand solo
per le azioni; per gli esiti si usano verde e rosso funzionali.

### Le variabili da sostituire

In `apps/web/app/app.vue`:

| Oggi | Diventa |
|---|---|
| `--accent: #e1502e` | `#ff4758` |
| `--bg: #fbfaf8` | `#ffffff` (console) / `#f6f3ef` (attendee) |
| `--ink: #20272b` | `#171717` / `#262626` |
| `--muted: #64707a` | `#525252` / `#a3a3a3` |
| `--line: #e2e0db` | `#e5e5e5` |
| `--ok: #1e7a55` | `#16a34a` |
| `--warn: #b3831a` | `#eab308` |
| font Avenir | stack Google Sans → Figtree |
| raggio pannelli 12px | 16px card / 32px pannelli (web) · 16pt (app) |
| raggio bottoni 8px | 6px (web) · pastiglia piena (app) |

```css
:root {
  --brand: #ff4758;
  --brand-soft: #ffa2aa;
  --brand-tint: rgba(255, 71, 88, 0.08);

  --surface: #ffffff;
  --surface-sunken: #f5f5f5;
  --sand: #f6f3ef;
  --sand-deep: #efe9e2;
  --line: #e5e5e5;

  --ink: #171717;
  --ink-strong: #262626;
  --body: #404040;
  --muted: #525252;
  --faint: #a3a3a3;

  --tile: #dfe8e9;
  --tag: #ddeff0;
  --tag-ink: #2d454c;
  --ok: #16a34a;
  --warn: #eab308;

  --r-control: 6px;
  --r-card: 16px;
  --r-panel: 32px;
  --r-full: 9999px;
}
```

---

## 9. Cosa non copiamo

**Il logo WeRoad e il lockup «wemeet.»** Non li mettiamo. È una risposta a un
business case, non un sito WeRoad: usare il marchio farebbe sembrare la demo un
prodotto ufficiale, ed è esattamente il tipo di ambiguità da evitare. Colore,
forma e tono bastano a rendere l'appartenenza.

**I font sotto licenza.** Vedi §3.

**Le fotografie.** Le loro immagini sono coperte da diritti. Dove serve
un'immagine, meglio un fondo pieno o niente.

---

## 10. Cosa è già applicato

Questa sezione è il registro: senza, il documento resta un'intenzione e nessuno
sa più cosa manca.

**Fondamenta** (`apps/web/app/app.vue`). Il blocco `:root` di §8 è quello vero;
i vecchi nomi (`--accent`, `--panel`, `--bg`) restano come alias così le
pagine non ancora ripulite continuano a girare. Il corallo `#ff4758` ha
sostituito l'arancio bruciato `#e1502e` ovunque. Raggi: 6px sui controlli,
16px sulle card, pastiglia piena dove si tocca. Nessuna ombra, tranne quella
appena percettibile sotto la barra d'azione fissa.

**Il carattere.** Figtree è installata e servita dal nostro dominio
(`@fontsource-variable/figtree`, licenza OFL), dichiarata dopo Google Sans.
Una nota da non perdere: il nome che registra il pacchetto è **«Figtree
Variable»**, non «Figtree» — con lo stack di §3 alla lettera il fallback non
aggancia mai il file che abbiamo appena installato, e si vede solo misurando.

**I tre sistemi si separano in `app.vue`**, non a mano pagina per pagina: la
rotta decide. `/attendee/*` prende il guscio `.phone` (sabbia fino ai bordi
dello schermo, colonna da 430px, niente padding da scrivania); tutto il resto
prende `.desk` (bianco, 960px). Una riga sola, e la differenza di §1 smette di
essere una raccomandazione.

**Vista attendee** — rifatta sulla struttura del dettaglio evento dell'app:
testata a tutto schermo con pastiglia di stato e titolo bianco, card che
risale di 24px, righe informative con tessere `#dfe8e9`, barra d'azione fissa
a pastiglia con etichetta a sinistra e azione a destra. Al posto della loro
fotografia c'è un fondo pieno scuro con un velo corallo: le foto di WeRoad non
le copiamo (§9), ma un rettangolo nero e basta si legge come un'immagine che
non è arrivata.

E la regola di §7 è applicata sul serio: **l'attendee non legge più il
vocabolario della verifica.** Dove c'era «Prova di prossimità», «borsellino
(PowerSync)», «provenance: machine», adesso c'è «Ci sei», «Sei qui da 42
minuti», «Niente rete, nessun problema». Le etichette vere restano — chiuse in
un `<details>` chiamato «Dietro le quinte (demo)», perché chi guarda la demo
deve poterle vedere e chi è all'aperitivo no.

**Console** — resta il linguaggio del web e ha ereditato i token. Una frase è
stata rimossa perché era falsa: *«ruota ogni 30 secondi — screenshottarlo non
serve a niente»*. È la stessa affermazione che avevamo già corretto nel
documento e in `CONTEXT.md`, sopravvissuta nell'interfaccia.

**Sandbox** — gli esiti si separano a colpo d'occhio: verde quando il sistema
ha tenuto, rosso funzionale `#dc2626` quando l'attacco è passato. Il rosso del
brand resta solo sui bottoni, perché lì vuol dire «ci si clicca».

---

## 11. Rimasto aperto

- **La schermata di avvio dell'app è scura** (fondo quasi nero, marchio bianco,
  tag rosso) mentre l'app è chiara e calda. È una schermata di lancio brandizzata,
  non una modalità scura: **non ho visto una modalità scura da nessuna parte**,
  né sul web né nell'app. Finché non c'è conferma, la demo resta chiara.
- **Le ombre nell'app** non sono determinabili con certezza da uno screenshot.
  Le card sembrano piatte e si staccano per contrasto: partiamo da lì, e se
  serve un'ombra si tiene appena percettibile.
- **La tipografia dell'app è stimata**, non misurata. Da verificare se emerge
  una fonte migliore degli screenshot.
- **Le schermate mancanti**: biglietti, messaggi, profilo, e soprattutto
  **cosa vede oggi l'attendee quando arriva a un evento** — che è il punto
  esatto in cui il nostro lavoro si innesta.
