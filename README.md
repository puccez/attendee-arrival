# attendee-arrival — ripensare il check-in dei WeMeet

**La posizione si dichiara, la prossimità si dimostra, la permanenza si conferma.**

Risposta al business case WeRoad sul check-in dei WeMeet — non un mockup: un
sistema costruito, deployato e collaudato su telefoni veri.

- **Il documento** (la risposta vera e propria): [`docs/business-case.md`](docs/business-case.md)
  — in testa c'è la guida di lettura per 2/10/30 minuti
- **Demo live** (da telefono o laptop, niente da installare): https://attendee-arrival-web.vercel.app
- **API in produzione** (Vercel + Postgres): https://attendee-arrival-api.vercel.app/health
- **Sandbox d'attacco**: si apre dalla console dell'evento che crei — ogni frode
  del brief parte davvero e atterra in dashboard con la sua etichetta

## L'idea in cinque righe

Al venue c'è un **beacon-notaio** (il telefono dell'host, o un ESP32) che emette
un **Codice Rotante**: un segreto effimero derivato ogni 30 secondi dal seme
dell'evento, conoscibile solo stando lì in quel minuto. Il telefono dell'attendee
lo raccoglie — via **radio** (BLE, zero gesti) o via **ottico** (QR, universale) —
e lo consegna al server, che ricalcola e verifica. Il GPS sveglia l'app, ma non è
mai una prova. Ogni check-in esce etichettato su due assi: **provenienza**
(macchina / umano / entrambi / nessuno) × **qualità** (codici, permanenza, buchi,
ritardo di consegna).

## La mappa del repo

| Dove | Cosa | Stack |
|---|---|---|
| [`packages/core`](packages/core) | Il cuore condiviso: derivazione del Codice Rotante e valutazione delle consegne. I test sono la specifica eseguibile del modello di fiducia | TypeScript |
| [`apps/api`](apps/api) | La **cucitura di verifica**: consegne, attestazioni dell'host, check-in etichettati. Test e2e black-box sull'HTTP | NestJS + Postgres |
| [`apps/web`](apps/web) | Console host, vista attendee, sandbox d'attacco. È il livello di fallback reale, non un mock del nativo | Nuxt / Vue |
| [`apps/mobile`](apps/mobile) | App nativa: geofence, cattura BLE in background, borsellino offline, **modalità notaio** (il telefono che emette). Modulo nativo `wemeet-beacon` in Kotlin/Swift | Expo / React Native |
| [`firmware/`](firmware) | Il beacon-notaio fisso: un ESP32 che deriva ed emette il codice come frame iBeacon. Test di parità C ↔ TypeScript | C / ESP-IDF |
| [`docs/`](docs) | Il business case, la spec tecnica, il linguaggio visivo | — |

Il glossario dei termini del progetto è in [`CONTEXT.md`](CONTEXT.md).

## Avviare

```sh
pnpm install
pnpm dev        # turbo: API (tsx watch) + web (nuxt dev)
pnpm test       # core + api + web
pnpm typecheck
```

L'app mobile sta **fuori** dal workspace pnpm (Expo/Hermes hanno le loro regole
di risoluzione — il perché è nel suo [README](apps/mobile/README.md)):

```sh
cd apps/mobile
npm ci
npm test        # la logica pura: arrivo, borsellino, parser iBeacon, parità notaio
npm run android # dev build (serve un device o un emulatore)
```

Il firmware si compila e si prova con PlatformIO: vedi
[`firmware/README.md`](firmware/README.md).

## Da dove cominciare a leggere

1. [`docs/business-case.md`](docs/business-case.md) — la risposta al brief, con
   la tabella di tracciabilità in prima pagina e il reality check in fondo
2. [`packages/core/test/verification.test.ts`](packages/core/test/verification.test.ts)
   — il modello di fiducia, un comportamento per test
3. [`docs/spec.md`](docs/spec.md) — la spec tecnica, per chi vuole i dettagli
