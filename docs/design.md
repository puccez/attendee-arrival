# Il linguaggio visivo: come si veste questa demo

Questo documento non è un moodboard. È l'insieme di regole che rendono la demo
riconoscibile come **una cosa di WeRoad** invece che come il progetto di
qualcuno che ha letto il brief.

---

## 0. Da dove vengono questi numeri

Non sono a occhio. Ho aperto `weroad.it`, la sezione `/wemeet/eventi` e una
pagina di dettaglio evento, e ho letto gli **stili calcolati dal browser**:
colori effettivamente dipinti, dimensioni dei caratteri, raggi dei bordi,
spaziature. Dove scrivo un numero, quel numero è misurato.

Due cose che invece **non** ho visto, e vanno dette:

- **Gli screenshot dell'app WeMeet non sono arrivati.** In
  `~/Downloads/taildrop` c'è solo materiale di ieri. Quindi questo documento
  descrive il **web** di WeRoad. Se gli screen erano dell'app mobile — che è
  dove vive davvero l'esperienza attendee — mancano all'appello le convenzioni
  native: navigazione, bottom bar, schede, stati vuoti. Quando arrivano, li
  incorporo qui.
- **Il comportamento responsive** l'ho dedotto, non misurato a viewport
  ridotto. Le regole mobile qui sotto sono coerenti con la scala desktop
  osservata, ma vanno verificate su un telefono vero.

---

## 1. Il carattere, prima dei numeri

Guardando il sito, tre cose colpiscono — e sono quelle da rubare:

**Bianco, e molto.** Nessun fondo colorato a riempire, nessuna texture. Il
colore entra in tre posti soltanto: le fotografie, il rosso corallo dei
richiami all'azione, e qualche pastiglia di stato. Tutto il resto è bianco con
grigi neutri. È un sito che si fida del contenuto.

**Nessuna ombra.** Questa è la sorpresa. Le card non galleggiano: sono definite
da **un bordo di un pixel e un raggio generoso**. In tutta la superficie
campionata il `box-shadow` è `none`. È una scelta forte e coerente, e va
rispettata — un'ombra sbagliata è ciò che fa sembrare un'interfaccia
«di un altro sito».

**Titoli grossi, testo piccolo.** Un `h1` a 48px con interlinea 48px — cioè
compattissima — accanto a un corpo di 16px. Il salto è netto: non ci sono
sette livelli intermedi. La gerarchia si fa con due o tre gradini, mai con
sfumature.

E sotto tutto questo, un tono: **ti dà del tu, è caldo, non è mai
istituzionale.** «Scopri il mondo. Conosci nuovi amici.» «Pronto a fare nuove
amicizie?» «Ma niente panico: ce ne sono tanti altri!»

---

## 2. Colore

Palette misurata, in ordine di quanto compare:

| Ruolo | Valore | Dove |
|---|---|---|
| **Brand** | `#ff4758` | Logo, ogni bottone primario, link, banner promo |
| Superficie | `#ffffff` | Fondo di tutto |
| Superficie incassata | `#f5f5f5` | Pannelli laterali, gruppi di filtri |
| Titoli | `#171717` | `h1`, `h2` |
| Testo forte | `#262626` | Titoli di card, testo enfatico |
| Testo | `#404040` | Corpo |
| Testo secondario | `#525252` | Sottotitoli, meta |
| Testo tenue | `#a3a3a3` | Etichette, unità di misura |
| Linee | `#e5e5e5` | **Ogni** bordo di card, pastiglia, separatore |
| Teal | `#418089` · scuro `#2f7580` · tinta `#f2f9f9` | Azione secondaria |
| Verde | `#16a34a` · `#1dad70` | Successo, valutazioni |
| Giallo | `#eab308` (testo bianco) | Badge di stato tipo «Sold Out» |
| Sabbia | `#f5ece5` | Fondi caldi occasionali |

Il brand è **corallo, non arancione**: `#ff4758` tira al rosa. La demo oggi usa
`#e1502e`, che è un arancio bruciato — sbagliato, e si nota accostandoli.

I grigi sono esattamente la scala `neutral` di Tailwind. Non è un caso: il sito
è costruito così, e adottare la stessa scala ci fa combaciare senza sforzo.

> **Il rosso è solo per agire.** Non è un colore decorativo: se una superficie è
> rossa, ci si clicca. Un titolo rosso, un bordo rosso, un'icona rossa
> «decorativa» rompono la convenzione più visibile del brand.

---

## 3. Tipografia

Il sito usa **Google Sans** (variabile, auto-ospitato). Stack dichiarato:
`"Google Sans", sans-serif`.

Scala misurata, desktop:

| Livello | Dimensione / interlinea | Peso | Colore |
|---|---|---|---|
| Titolo pagina | 48 / 48 | 700 | `#171717` |
| Sezione | 36 / 40 | 700 | `#262626` |
| Sottosezione | 24 / 32 | 600 | inherit |
| Occhiello forte | 20 / 28 | 700 | `#262626` |
| Corpo | 16 / 24 | 400 | `#404040` |
| Titolo di card | 16 / 24 | 600 | `#262626` |
| Piccolo | 14 / 20 | 400 | `#525252` |
| Micro (pastiglie) | 12 / 16 | 500 | `#262626` |

Da notare: **nessuna spaziatura fra lettere**, mai. E l'interlinea dei titoli è
1.0 — stretta. Un titolo grande con interlinea larga è il modo più rapido per
non somigliargli.

Su mobile il titolo pagina scende a **30–36px** mantenendo interlinea ~1.1; il
resto della scala non cambia. *(Da verificare su dispositivo.)*

### Sul font, una nota onesta

Google Sans è proprietario. WeRoad lo ospita perché presumibilmente ha titolo
per farlo; **noi no**, e ridistribuirlo in una demo pubblica non è una cosa da
fare per un business case.

Quindi: dichiariamo lo stack con Google Sans in testa — chi apre da un
dispositivo che ce l'ha lo vede giusto — e mettiamo dietro un'alternativa
aperta con la stessa personalità (geometrica, umanista, occhio medio alto).
**Figtree** è la più vicina; Inter va bene ed è ovunque.

```css
font-family: "Google Sans", Figtree, Inter, system-ui, sans-serif;
```

È anche una riga che vale la pena dire ad alta voce nel documento: sappiamo
cos'è un font sotto licenza.

---

## 4. Forma

Quattro raggi, e servono tutti:

| Raggio | Dove |
|---|---|
| `6px` | Bottoni, pastiglie, badge, voci di menu, campi |
| `16px` | Card di lista (l'evento in elenco) |
| `32px` | Pannelli grandi, immagine hero, superfici di pagina |
| `9999px` | Avatar, contatori circolari |

**Bordi**: sempre `1px solid #e5e5e5`. È il separatore universale.

**Ombre**: nessuna. Se serve staccare qualcosa, si usa il fondo incassato
`#f5f5f5` o un bordo — non un'ombra.

---

## 5. Componenti

### Bottone primario
```
background #ff4758 · testo #ffffff · 16px/500 · raggio 6px
padding 0 16px · altezza ~48px · nessuna ombra · nessun bordo
```
A tutta larghezza dentro un pannello; a contenuto altrove.

### Bottone secondario
Fondo bianco, `1px solid #e5e5e5`, testo `#404040`, stesso raggio e altezza.

### Pastiglia (categoria, prezzo, stato)
```
12px/500 · raggio 6px · padding 4px 8px · 1px solid #e5e5e5 · fondo trasparente
```
Il badge di stato pieno (tipo «Sold Out») fa eccezione: fondo `#eab308`, testo
bianco, 14px/500, stesso raggio.

### Card di lista
```
raggio 16px · 1px solid #e5e5e5 · padding 16px · nessuna ombra
```
Struttura osservata, dall'alto: riga meta (icona calendario · data · giorno |
icona orologio · ora) in 14px grigio → titolo 16px/600 → riga luogo (icona
pin · indirizzo | distanza) → pastiglie → pila di avatar. Miniatura quadrata
a destra, raggio 16px.

Il separatore fra i campi meta è `‧` (U+2027), non il punto elenco.

### Pannello
Raggio 32px. Bianco su fondo colorato, oppure `#f5f5f5` su bianco.

### Pila di avatar
Cerchi da 40px sovrapposti con anello bianco, e un contatore `+N` come ultimo
cerchio. È il modo in cui il sito dice «qui c'è gente» senza scrivere un numero
in una tabella — e per noi vale il doppio, perché è letteralmente il nostro
problema.

### Barra dei filtri
Campi uniti in un gruppo segmentato (il primo con raggio solo a sinistra, il
successivo attaccato), poi menu a tendina separati come pastiglie con freccia.
Altezza ~48px.

---

## 6. Layout

- Colonna di testo: **960px**. Contenitore esterno fino a ~1270px.
- Lista + spalla: card ~553px, pannello laterale ~350px.
- Spaziature su griglia di 4: `4 · 8 · 16 · 24 · 40`. Il salto tipico fra
  blocchi è 40px, dentro una card è 16px.
- Le icone sono **outline, piccole, grigie**, allineate al testo — mai piene,
  mai colorate.

---

## 7. Microcopy

Le regole si leggono dalle loro frasi:

- **Dai del tu.** «Scopri», «Conosci», «Trova il viaggio».
- **Domanda come titolo.** «Pronto a fare nuove amicizie?» «Chi c'è? (16)»
- **Rassicura invece di scusarti.** «Ma niente panico: ce ne sono tanti altri!»
- **Frasi corte, punto fermo.** «Scopri il mondo. Conosci nuovi amici.»
- Zero gergo, zero passivo, zero «la piattaforma consente di».

Per noi c'è una tensione da gestire, e vale la pena nominarla: il nostro
prodotto parla di **prove, frodi e verifiche**, che è un registro freddo. La
regola che propongo: **l'attendee non deve mai leggere il vocabolario della
verifica.** Vede «Sei al WeMeet», «Ci sei» — non «provenienza: machine». Il
vocabolario tecnico vive nella console dell'host e nella sandbox, dove è
esattamente ciò che si vuole mostrare.

---

## 8. Cosa cambia nella demo di oggi

Le variabili in `apps/web/app/app.vue` vanno sostituite. Mapping diretto:

| Oggi | Diventa | Perché |
|---|---|---|
| `--accent: #e1502e` | `#ff4758` | Il rosso era un arancio bruciato |
| `--bg: #fbfaf8` | `#ffffff` (+ `#f5f5f5` incassato) | Loro sono bianco-primo, non crema |
| `--ink: #20272b` | `#171717` / `#262626` | Il loro nero è neutro, il nostro tirava al blu |
| `--muted: #64707a` | `#525252` / `#a3a3a3` | Idem: grigi neutri, non freddi |
| `--line: #e2e0db` | `#e5e5e5` | Idem |
| `--ok: #1e7a55` | `#16a34a` | |
| `--warn: #b3831a` | `#eab308` | |
| font Avenir | stack Google Sans → Figtree | Avenir non c'entra niente |
| raggio pannelli 12px | 16px card / 32px pannelli | Loro sono più generosi |
| raggio bottoni 8px | 6px | |

Blocco pronto:

```css
:root {
  --brand: #ff4758;
  --brand-tint: rgba(255, 71, 88, 0.08);

  --surface: #ffffff;
  --surface-sunken: #f5f5f5;
  --line: #e5e5e5;

  --ink: #171717;
  --ink-strong: #262626;
  --body: #404040;
  --muted: #525252;
  --faint: #a3a3a3;

  --teal: #418089;
  --teal-tint: #f2f9f9;
  --ok: #16a34a;
  --warn: #eab308;
  --sand: #f5ece5;

  --r-control: 6px;
  --r-card: 16px;
  --r-panel: 32px;
  --r-full: 9999px;
}
```

### Le tre superfici

**Vista attendee** — è quella che somiglia di più a loro, ed è l'unica che
girerà da telefono. Un pannello, un titolo grande, uno stato leggibile a un
metro di distanza. Il linguaggio della verifica sparisce: «Ci sei» e i minuti
al WeMeet, non le etichette del modello.

**Console host** — la tabella resta una tabella, ma le righe diventano card da
16px con la riga meta nel loro formato, e la pila di avatar sostituisce la
colonna del nome dove ha senso. Qui il vocabolario tecnico ci sta: è lo
strumento di chi deve capire.

**Sandbox d'attacco** — è l'unico posto dove **ci si allontana di proposito**.
Deve sembrare un laboratorio, non una pagina di prodotto: monospaziato per i
codici, esiti che si distinguono a colpo d'occhio. Un attacco che sembra un
pulsante di marketing non si legge. Resta il rosso del brand solo per le
azioni; per gli esiti si usano verde e rosso funzionali.

---

## 9. Cosa non copiamo

**Il logo WeRoad e il lockup «we meet.»** Non li mettiamo. È una risposta a un
business case, non un sito WeRoad: usare il marchio farebbe sembrare la demo un
prodotto ufficiale, ed è esattamente il tipo di ambiguità da evitare. Il colore
e le proporzioni bastano a rendere l'appartenenza.

**I font sotto licenza.** Vedi §3.

**Le fotografie.** Le loro immagini sono coperte da diritti. Dove serve
un'immagine, meglio un fondo pieno o niente.

---

## 10. Rimasto aperto

- **Gli screenshot dell'app WeMeet.** Se l'esperienza attendee di riferimento è
  nativa, questo documento va esteso con le convenzioni dell'app. È il pezzo
  che manca, ed è quello più vicino a ciò che stiamo costruendo.
- **Verifica su telefono vero** della scala tipografica e dei filtri.
- **Modalità scura**: sul loro sito non l'ho trovata. Finché non c'è conferma,
  la demo resta chiara e basta.
