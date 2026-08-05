<script setup lang="ts">
import { useApi, type ApiCheckIn } from "../../composables/useApi";

const route = useRoute();
const eventId = route.params.id as string;
const api = useApi();

interface AttackOutcome {
  checkIn: ApiCheckIn;
  verdict: string;
}

const outcomes = reactive<Record<string, AttackOutcome | null>>({
  gps: null,
  tap: null,
  screenshot: null,
  hitrun: null,
  late: null,
});
const busy = reactive<Record<string, boolean>>({});

async function deliver(
  key: string,
  deviceId: string,
  attendeeName: string,
  body: Record<string, unknown>,
  verdictFor: (c: ApiCheckIn) => string,
) {
  busy[key] = true;
  try {
    const checkIn = await api.post<ApiCheckIn>(
      `/events/${eventId}/deliveries`,
      { deviceId, attendeeName, codes: [], ...body },
    );
    outcomes[key] = { checkIn, verdict: verdictFor(checkIn) };
  } finally {
    busy[key] = false;
  }
}

// ── 1. GPS spoofato ─────────────────────────────────────────────
function attackGps() {
  return deliver(
    "gps",
    "attacker-gps",
    "🛋 Spoofer GPS",
    { gps: { insideGeofence: true } },
    () =>
      "Il GPS dichiarava «dentro il geofence», ma la posizione si dichiara — non si dimostra. Senza codici raccolti al venue, per il server non esisti.",
  );
}

// ── 2. L'amico che conferma ─────────────────────────────────────
function attackTap() {
  return deliver(
    "tap",
    "attacker-tap",
    "👆 Amico compiacente",
    { confirmationTap: true },
    () =>
      "Il tap sulla notifica arricchisce un check-in, non lo crea. Senza prova di prossimità il tap dal divano non produce nulla.",
  );
}

// ── 3. QR screenshottato ────────────────────────────────────────
// Due modi di provarci con lo stesso screenshot, e solo uno funziona —
// l'opposto di quello che verrebbe da pensare.
//
// Mentire sull'ora non funziona: il server ricalcola il codice atteso per
// l'istante che dichiari, e una finestra sbagliata non corrisponde. È la
// proprietà autodatante del Codice Rotante.
//
// Dire la verità sull'ora funziona, e continua a funzionare finché la
// finestra di consegna resta aperta — sei ore, non sessanta secondi. Non è
// un difetto dell'implementazione: un codice broadcast è un titolo al
// portatore, e un titolo al portatore si può passare. Quello che il sistema
// può fare non è impedirlo, è misurarlo (`deliveryLagMinutes`).
const frozenCode = ref<string | null>(null);
const frozenAt = ref<Date | null>(null);
const frozenAgeS = ref(0);
let ageTicker: ReturnType<typeof setInterval> | undefined;

// Quanto vive una bugia sull'ora. Il server accetta la finestra dichiarata più
// le due adiacenti, e il codice può essere nato in qualunque punto della sua:
// «l'ho appena preso io» regge fino a 60 s nel caso peggiore e 90 s nel
// migliore. Sopra i 90 non regge mai — ed è lì che i due tentativi si separano.
const lieMayStillHold = computed(() => frozenAgeS.value < 90);

async function takeScreenshot() {
  const { code } = await api.get<{ code: string }>(`/events/${eventId}/code`);
  frozenCode.value = code;
  frozenAt.value = new Date();
  frozenAgeS.value = 0;
  outcomes.screenshot = null;
  if (ageTicker) clearInterval(ageTicker);
  ageTicker = setInterval(() => (frozenAgeS.value += 1), 1000);
}

/** L'attacco vero: il complice dichiara l'ora in cui il codice è nato. */
function attackForwardHonest() {
  const ageAtSend = frozenAgeS.value;
  return deliver(
    "screenshot",
    "attacker-screenshot-onesto",
    "📸 Amico con screenshot (ora vera)",
    {
      codes: [
        { value: frozenCode.value, collectedAt: frozenAt.value?.toISOString() },
      ],
    },
    (c) =>
      c.accredited
        ? `Passato, e passerebbe anche fra tre ore. Il codice prova che qualcuno era al venue in quel minuto — non chi teneva in mano il telefono. Dichiarando l'ora vera l'inoltro funziona finché resta aperta la finestra di consegna (sei ore), non sessanta secondi: è la frode che questo design non previene, ed è giusto vederla.\n\nQuello che si vede però è tutto: guarda la riga in dashboard — ${c.quality.validCodes} codice, ${c.quality.coverageMinutes} minuti di copertura, prova vecchia di ${c.quality.deliveryLagMinutes} min quando è arrivata. Chi è davvero lì consegna in diretta e accumula copertura; qui serve un complice al venue che inoltri per tutta la sera — e a quel punto poteva portarti con sé.`
        : `Respinto, ma non per l'inoltro: sono passati ${ageAtSend} s e la consegna è comunque arrivata oltre la finestra dichiarata. Riprova subito dopo lo screenshot.`,
  );
}

/** L'attacco ingenuo: fingere di aver appena raccolto il codice. */
function attackForwardNaive() {
  const ageAtSend = frozenAgeS.value;
  return deliver(
    "screenshot",
    "attacker-screenshot-bugiardo",
    "📸 Amico con screenshot (ora falsa)",
    {
      codes: [
        { value: frozenCode.value, collectedAt: new Date().toISOString() },
      ],
    },
    (c) =>
      c.accredited
        ? `Passato, ma solo perché sono trascorsi ${ageAtSend} s e sei ancora dentro la finestra del codice (30 s più una di tolleranza per lo skew d'orologio). Aspetta oltre il minuto e riprova: la bugia smette di reggere.`
        : `Respinto. Hai dichiarato di aver raccolto ${frozenCode.value} adesso, ma quel codice apparteneva alla finestra di ${ageAtSend} secondi fa: il server ricalcola dal seme quello atteso per l'istante che dichiari, e non corrisponde. Il codice è autodatante — mentire sull'ora lo rompe.\n\nE allora prova a dire la verità: l'altro bottone dichiara l'ora giusta, e quello passa.`,
  );
}

// ── 4. Check-in e fuga ──────────────────────────────────────────
async function attackHitAndRun() {
  const { code } = await api.get<{ code: string }>(`/events/${eventId}/code`);
  return deliver(
    "hitrun",
    "attacker-hitrun",
    "🏃 Tocca e fuggi",
    { codes: [{ value: code, collectedAt: new Date().toISOString() }] },
    (c) =>
      `Accreditato, sì — eri davvero lì per un istante. Ma la permanenza si conferma, non si presume: ${c.quality.validCodes} codice, ${c.quality.coverageMinutes} minuti di copertura. L'host lo vede esattamente per quello che è.`,
  );
}

// ── 5. Bonus: codice inventato, consegnato ieri ─────────────────
// Due difese indipendenti sullo stesso payload, ed è utile vederle insieme.
function attackLate() {
  const guess = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
  const yesterday = new Date(Date.now() - 13 * 60 * 60 * 1000);
  return deliver(
    "late",
    "attacker-late",
    "⏰ Codice inventato di ieri",
    { codes: [{ value: guess, collectedAt: yesterday.toISOString() }] },
    () =>
      `Respinto due volte. Il codice ${guess} è stato tirato a caso su un milione di possibilità: il server ne accetta tre finestre, quindi una probabilità su ~333.000 per tentativo. E comunque una consegna che arriva oltre la finestra dichiarata (sei ore) viene scartata in blocco, codice buono o no.\n\nOnestà sul limite: la demo non ha rate limiting, quindi «poco pratico» non è «impedito» — in produzione è una riga di middleware, ed è dichiarata come tale.`,
  );
}

onUnmounted(() => {
  if (ageTicker) clearInterval(ageTicker);
});

function badgeClass(p: ApiCheckIn["provenance"]) {
  return p === "machine+human"
    ? "both"
    : p === "machine"
      ? "machine"
      : p === "human"
        ? "human"
        : "none";
}
</script>

<template>
  <div>
    <div class="eyebrow">Sandbox d'attacco</div>
    <h1>Prova a fregarlo</h1>
    <p class="muted" style="max-width: 60ch">
      Le quattro frodi del brief, più una. Ogni tentativo parte davvero e
      atterra sulla
      <NuxtLink :to="`/console/${eventId}`">dashboard dell'host</NuxtLink>
      con la sua etichetta: tienila aperta a fianco.
    </p>

    <div
      v-for="attack in [
        {
          key: 'gps',
          title: '1 · GPS spoofato',
          desc: 'Mock location dal divano: dichiari di essere dentro il geofence senza esserci.',
          run: attackGps,
          label: 'Spoofa la posizione',
        },
        {
          key: 'tap',
          title: '2 · L\'amico che conferma per te',
          desc: 'Un tap su «Confermo, sono qui» — da casa, senza aver mai raccolto un codice.',
          run: attackTap,
          label: 'Tappa la conferma',
        },
      ]"
      :key="attack.key"
      class="panel"
    >
      <h2>{{ attack.title }}</h2>
      <p class="muted" style="font-size: 14px">{{ attack.desc }}</p>
      <button :disabled="busy[attack.key]" @click="attack.run">
        {{ attack.label }}
      </button>
      <div v-if="outcomes[attack.key]" class="notice" style="margin-top: 12px">
        <span
          class="badge"
          :class="badgeClass(outcomes[attack.key]!.checkIn.provenance)"
        >
          {{ outcomes[attack.key]!.checkIn.provenance }}
        </span>
        <b style="margin-left: 6px">
          {{ outcomes[attack.key]!.checkIn.accredited ? "accreditato" : "respinto" }}
        </b>
        <p style="font-size: 14px; margin-top: 6px; white-space: pre-line">
          {{ outcomes[attack.key]!.verdict }}
        </p>
      </div>
    </div>

    <div class="panel">
      <h2>3 · QR screenshottato / inoltrato</h2>
      <p class="muted" style="font-size: 14px">
        Screenshotti il QR e lo giri a un amico rimasto a casa. Lui ha due
        modi di provarci — e funziona quello che non ti aspetti. Fai lo
        screenshot, <b>aspetta un minuto e mezzo</b>, poi prova entrambi.
      </p>
      <div class="row">
        <button :disabled="busy.screenshot" @click="takeScreenshot">
          📸 Screenshotta il codice di adesso
        </button>
      </div>
      <p v-if="frozenCode" class="muted" style="font-size: 13px">
        Screenshot di <b>{{ frozenCode }}</b
        >, vecchio di {{ frozenAgeS }} s —
        <span v-if="lieMayStillHold" style="color: var(--warn)">
          la bugia può ancora reggere (finestra più tolleranza di skew):
          aspetta i 90 s perché la differenza si veda
        </span>
        <span v-else style="color: var(--ok)">
          fuori da ogni finestra plausibile: adesso i due tentativi si separano
        </span>
      </p>
      <div class="row" style="margin-top: 12px">
        <button
          class="secondary"
          :disabled="!frozenCode || busy.screenshot"
          @click="attackForwardNaive"
        >
          🤥 «L'ho appena preso io»
        </button>
        <button
          class="secondary"
          :disabled="!frozenCode || busy.screenshot"
          @click="attackForwardHonest"
        >
          🎯 «Me l'ha girato lui alle {{
            frozenAt ? frozenAt.toLocaleTimeString("it-IT") : "—"
          }}»
        </button>
      </div>
      <div v-if="outcomes.screenshot" class="notice" style="margin-top: 12px">
        <span
          class="badge"
          :class="badgeClass(outcomes.screenshot.checkIn.provenance)"
        >
          {{ outcomes.screenshot.checkIn.provenance }}
        </span>
        <b style="margin-left: 6px">
          {{ outcomes.screenshot.checkIn.accredited ? "accreditato" : "respinto" }}
        </b>
        <p style="font-size: 14px; margin-top: 6px; white-space: pre-line">
          {{ outcomes.screenshot.verdict }}
        </p>
      </div>
    </div>

    <div class="panel">
      <h2>4 · Check-in e fuga</h2>
      <p class="muted" style="font-size: 14px">
        Entri, raccogli un codice vero, e scappi subito. L'unico attacco che
        «riesce» — e proprio per questo si vede.
      </p>
      <button :disabled="busy.hitrun" @click="attackHitAndRun">
        Raccogli un codice e scappa
      </button>
      <div v-if="outcomes.hitrun" class="notice" style="margin-top: 12px">
        <span
          class="badge"
          :class="badgeClass(outcomes.hitrun.checkIn.provenance)"
        >
          {{ outcomes.hitrun.checkIn.provenance }}
        </span>
        <b style="margin-left: 6px">
          {{ outcomes.hitrun.checkIn.accredited ? "accreditato" : "respinto" }}
        </b>
        <span style="font-size: 13px; margin-left: 8px">
          qualità: {{ outcomes.hitrun.checkIn.quality.validCodes }} codici ·
          {{ outcomes.hitrun.checkIn.quality.coverageMinutes }} min
        </span>
        <p style="font-size: 14px; margin-top: 6px; white-space: pre-line">
          {{ outcomes.hitrun.verdict }}
        </p>
      </div>
    </div>

    <div class="panel">
      <h2>Bonus · Codice tirato a indovinare, consegnato ieri</h2>
      <p class="muted" style="font-size: 14px">
        Sei cifre a caso, datate 13 ore fa: provi la forza bruta e la
        tolleranza per l'offline nello stesso colpo.
      </p>
      <button :disabled="busy.late" @click="attackLate">
        Tira a indovinare
      </button>
      <div v-if="outcomes.late" class="notice" style="margin-top: 12px">
        <span class="badge" :class="badgeClass(outcomes.late.checkIn.provenance)">
          {{ outcomes.late.checkIn.provenance }}
        </span>
        <b style="margin-left: 6px">
          {{ outcomes.late.checkIn.accredited ? "accreditato" : "respinto" }}
        </b>
        <p style="font-size: 14px; margin-top: 6px; white-space: pre-line">
          {{ outcomes.late.verdict }}
        </p>
      </div>
    </div>

    <p class="muted" style="font-size: 13px; max-width: 62ch">
      La tesi, vissuta: <i>la posizione si dichiara, la prossimità si
      dimostra, la permanenza si conferma</i>. Le frodi non vengono nascoste
      da un punteggio — vengono etichettate, e chi consuma il dato decide
      quanto valgono.
    </p>
  </div>
</template>
