# Verso il dieci

**Cosa manca fra l'8/10 del revisore ostile e il massimo — e cosa il massimo
costa davvero.**

Tre giri di review esterna (GPT 5.6, mandato: severità senza cortesie) hanno
tracciato la curva: 6/10 → 7/10 → 8/10. I primi due punti sono arrivati
correggendo il *testo* — il documento vendeva peggio di quello che il codice
faceva, o prometteva più di quanto il sistema mantenesse. Da qui in su la
scrittura non compra più nulla: **i punti restanti si pagano con prove e
produzione**, e uno probabilmente non si compra affatto.

---

## 1. Quello che si compra col documento (→ ~9, giorni di lavoro)

### 1.1 Il threat model formale

La richiesta mai chiusa in tre verdetti. Il contenuto esiste già, sparso fra
§6 e §9 del business case; manca la *forma* che un revisore di sicurezza
riconosce come specifica. Una tabella sola:

| Attaccante | Incentivo | Attacco | Costo per lui | Frode residua accettata |
|---|---|---|---|---|
| divanista | badge gratis | GPS finto | zero — e ottiene `nessuno` | nessuna |
| amico gentile | favore | tap per conto terzi | zero — e non crea nulla | nessuna |
| inoltratore ingenuo | presenza | screenshot in diretta | scade col minuto | nessuna |
| inoltratore informato | presenza | screenshot + ora di nascita | un complice presente | presenza a bassa qualità, etichettata |
| relay industriale | serata intera | bot/video sul QR | complice presente tutta la sera | dwell falso, firma nel dato |
| prestito del telefono | qualunque | consegna il device | il telefono per una sera | irrisolvibile senza biometria |

Ogni riga chiude con la posizione del sistema: prevenuta per costruzione,
prezzata e visibile, o dichiarata irrisolvibile. Niente da inventare: solo da
impaginare.

### 1.2 I livelli di fiducia espliciti

Distinguere formalmente, come tier dichiarati: *token visto* → *device
verificato* → *persona verificata* → *permanenza qualificata*. Gli assi
provenienza × qualità li contengono già; dichiararli come scala chiude
l'obiezione «la gerarchia è implicita».

### 1.3 Le due frasi-manifesto (decisione d'autore)

«Percepibile solo standoci dentro» (§2) e «il venue testimonia che c'era»
(§13): il revisore le lima a ogni giro, perché a rigore il relay le smentisce.
Ammorbidirle compra rigore e vende retorica. Posizione consigliata: tenerle —
il reality check ormai le onora, e un business case senza una tesi detta con
forza non si ricorda. Ma è una scelta di voce, non di tecnica.

---

## 2. Quello che si compra col sistema (→ 10, settimane/mesi)

1. **Dati di campo veri.** Due o tre WeMeet pilota con distribuzioni
   pubblicate: tassi di risveglio iOS/Android, buchi tipici di copertura,
   consumo batteria, falsi negativi. Ricorre in tutti e tre i verdetti:
   nessuna frase può sostituire questi numeri.
2. **Autenticazione e rate limiting reali.** Arrivano con l'aggancio ai
   sistemi WeRoad esistenti (posizione già dichiarata in §9.2). A quel punto
   «la demo è aggirabile» cade da sola: le righe passano da promesse a fatti.
3. **Il percorso forte implementato.** Biometria on-device al tap + App
   Attest / Play Integrity per i benefici sensibili — oggi è hardening
   dichiarato, deve diventare codice.
4. **Il confronto host-scan misurato.** Throughput reale a un evento vero:
   secondi per scansione, coda a cinquanta arrivi, attenzione dell'host
   consumata. Oggi il confronto è concettuale; misurato, diventa definitivo.

---

## 3. Il tetto — da dire ad alta voce

Anche con tutto questo, un revisore ostile può non dare mai 10: il legame
persona↔telefono e il relay in diretta **non sono chiudibili da nessun
design** dentro i vincoli di WeMeet (evento gratuito, niente hardware
obbligatorio, zero checkpoint, host che fa accoglienza). L'ha scritto lui:

> «A parità di vincoli, non vedo un design alternativo che domini strettamente
> questo su tutte le dimensioni. […] Questo design è un compromesso
> ragionevole sul fronte di Pareto.»

Il che rovescia la domanda. Per *vincere il business case* non serve il 10 del
revisore di sicurezza: serve l'8 con scritto sotto «nessuna alternativa lo
domina» — che c'è già. La mossa giusta è fare il punto 1 (threat model) prima
della presentazione, e presentare i punti del capitolo 2 **come roadmap**: una
roadmap dichiarata è più credibile di una perfezione finta.

Il 10 vero non è un voto: è il sistema in produzione che regge la sua prima
stagione di eventi coi numeri pubblicati accanto.
