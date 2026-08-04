# Scaletta del video — il canale radio (tier 2)

> Materiale per la consegna. Il tier 1 (demo web) si mostra dal link; qui
> si mostra ciò che il browser non può fare: **il telefono in tasca**.
> Durata: 2 minuti. Nessuna voce fuori campo obbligatoria — bastano le
> didascalie, ma il parlato aiuta.

**Tesi da far vedere, non da dire:** *la posizione si dichiara, la
prossimità si dimostra, la permanenza si conferma.*

## Cosa serve in mano

- ESP32 flashato e alimentato (power bank: deve stare su un tavolo, non
  attaccato al laptop — sembra un oggetto, non un prototipo).
- Telefono con la dev build installata, evento già impostato.
- Laptop con la console host aperta sulla dashboard dell'evento.
- Un'app scanner BLE generica (nRF Connect) sul telefono, per la prova
  d'indipendenza.

## Prima di girare

```bash
# crea l'evento e prendi il seme
curl -s -X POST https://attendee-arrival-api.vercel.app/events \
  -H 'content-type: application/json' \
  -d '{"name":"WeMeet Milano","startsAt":"…","endsAt":"…"}'
```

Poi, dal monitor seriale dell'ESP32: `wifi <ssid> <pass>`, `seed <hex>`,
`status` (verifica che l'ora sia sincronizzata — senza, il beacon annuncia
`major=0 minor=0` e non c'è niente da raccogliere).

## Le sei inquadrature

**1. L'oggetto (10 s).** L'ESP32 sul tavolo, primo piano. Didascalia: *"Il
beacon-notaio. Non è connesso a niente e non vede nessuno."*

**2. Il codice in onda (20 s).** nRF Connect sullo stesso telefono: si vede
`wemeet-notaio`, `major 12`, `minor 3456`. Accanto, la console host mostra
il QR con `123456`. Didascalia: *"Stesso codice, due canali. Radio e
ottico."* — **questa è l'inquadratura che dimostra che il BLE non è
slideware**: lo legge uno scanner generico, non la nostra app.

**3. Il cambio di finestra (10 s).** Si resta su nRF Connect e si aspetta:
minor cambia. Didascalia: *"Ogni 30 secondi. Uno screenshot muore prima di
arrivare a destinazione."*

**4. Il telefono in tasca (30 s).** La ripresa esce dalla stanza col
telefono in tasca — schermo spento, app chiusa. Si rientra. Il telefono
vibra: **notifica one-tap**. Didascalia: *"Nessun gesto. Il sistema lo
sveglia l'ingresso nel raggio."* Si tocca la notifica: si apre l'app con i
codici già raccolti.

**5. La dashboard che si popola (20 s).** Laptop: l'attendee compare con
provenienza **macchina**. Didascalia: *"Provenienza: macchina. La prova è
il codice, non il GPS."*

**6. La permanenza (20 s).** Salto temporale (didascalia "45 minuti dopo").
La stessa riga in dashboard: più codici, più minuti coperti. Didascalia:
*"La permanenza si conferma: inoltrare un codice costa un messaggio,
inoltrarne per due ore costa un complice."*

## Chiusura (10 s)

Schermo nero, tre righe:

> La posizione si dichiara.
> La prossimità si dimostra.
> La permanenza si conferma.

## Cose da dire mentre si gira (o in didascalia)

- **Il beacon non vede nessuno.** Non riceve, non si connette, non sa chi
  c'è. La direzione è telefono-ascolta.
- **Il seme è per-evento.** Compromettere un beacon non eccede la fiducia
  già riposta nell'host di quell'evento.
- **Il server non distingue i client.** Il check-in del video passa dalla
  stessa API della demo web: il canale cambia, la verifica no.

## Onestà che vale la pena mostrare

Se qualcosa non funziona al primo colpo, **mostralo**: stacca
l'alimentazione all'ESP32 e riattaccala. Il beacon riparte con
`major=0 minor=0` finché non risincronizza l'ora — l'app dice "beacon in
ascolto" ma nessun codice da raccogliere. È il limite dichiarato
(l'ESP32 non ha RTC a batteria) ed è anche il motivo per cui il default di
prodotto è il telefono dell'host. Un limite mostrato vale più di una demo
senza attriti.
