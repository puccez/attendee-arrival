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
// Il codice vale la sua finestra (30 s) più una di tolleranza per lo skew
// d'orologio tra beacon e telefono: la vita utile di uno screenshot è
// ~60 s, non oltre. La sandbox mostra entrambe le fasi.
const frozenCode = ref<string | null>(null);
const frozenAgeS = ref(0);
let ageTicker: ReturnType<typeof setInterval> | undefined;

const stillValid = computed(() => frozenAgeS.value < 60);

async function takeScreenshot() {
  const { code } = await api.get<{ code: string }>(`/events/${eventId}/code`);
  frozenCode.value = code;
  frozenAgeS.value = 0;
  outcomes.screenshot = null;
  if (ageTicker) clearInterval(ageTicker);
  ageTicker = setInterval(() => (frozenAgeS.value += 1), 1000);
}

function attackScreenshot() {
  const ageAtSend = frozenAgeS.value;
  // Lo screenshot lo giri a un amico *diverso* ogni volta: è lui a
  // tentare il check-in con un codice che non ha mai ricevuto dal venue.
  const friend = stillValid.value ? "fresco" : "tardivo";
  return deliver(
    "screenshot",
    `attacker-screenshot-${friend}`,
    `📸 Amico con screenshot (${friend})`,
    {
      codes: [
        { value: frozenCode.value, collectedAt: new Date().toISOString() },
      ],
    },
    (c) =>
      c.accredited
        ? `Passato — e va detto: lo screenshot ha funzionato perché l'hai inoltrato dopo ${ageAtSend} s, dentro la vita utile del codice (30 s di finestra più una di tolleranza per lo skew d'orologio). È la finestra di frode residua, dichiarata: ~60 secondi e un complice sul posto. Aspetta oltre il minuto e riprova.`
        : `Il codice ${frozenCode.value} era vero quando l'hai «screenshottato» — dopo ${ageAtSend} s è fuori dalla sua finestra e non prova più niente. Screenshottare e inoltrare non scala: dovresti rifarlo ogni mezzo minuto, per tutta la serata.`,
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

// ── 5. Bonus: consegna oltre la finestra ────────────────────────
function attackLate() {
  const yesterday = new Date(Date.now() - 13 * 60 * 60 * 1000);
  return deliver(
    "late",
    "attacker-late",
    "⏰ Replay in ritardo",
    { codes: [{ value: "123456", collectedAt: yesterday.toISOString() }] },
    () =>
      "L'offline è tollerato dentro una finestra dichiarata (ore, non giorni): una consegna che arriva troppo tardi viene respinta in blocco. Il margine di replay esiste, ma è contenuto e dichiarato.",
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
        <p style="font-size: 14px; margin-top: 6px">
          {{ outcomes[attack.key]!.verdict }}
        </p>
      </div>
    </div>

    <div class="panel">
      <h2>3 · QR screenshottato / inoltrato</h2>
      <p class="muted" style="font-size: 14px">
        Screenshotti il QR di adesso e lo giri a un amico. Il codice ruota
        ogni 30 secondi: prova a inoltrarlo subito, poi riprova dopo un
        minuto e guarda la differenza.
      </p>
      <div class="row">
        <button :disabled="busy.screenshot" @click="takeScreenshot">
          📸 Screenshotta il codice di adesso
        </button>
        <button
          class="secondary"
          :disabled="!frozenCode || busy.screenshot"
          @click="attackScreenshot"
        >
          {{
            !frozenCode
              ? "…prima screenshotta"
              : `Inoltra lo screenshot (${frozenCode}, ${frozenAgeS}s)`
          }}
        </button>
      </div>
      <p v-if="frozenCode" class="muted" style="font-size: 13px">
        Screenshot vecchio di {{ frozenAgeS }} s —
        <span v-if="stillValid" style="color: var(--warn)">
          ancora dentro la vita utile del codice
        </span>
        <span v-else style="color: var(--ok)">
          scaduto: ora non prova più nulla
        </span>
      </p>
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
        <p style="font-size: 14px; margin-top: 6px">
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
        <p style="font-size: 14px; margin-top: 6px">
          {{ outcomes.hitrun.verdict }}
        </p>
      </div>
    </div>

    <div class="panel">
      <h2>Bonus · Replay oltre la finestra</h2>
      <p class="muted" style="font-size: 14px">
        Consegni codici «raccolti» 13 ore fa, sperando nella tolleranza per
        l'offline.
      </p>
      <button :disabled="busy.late" @click="attackLate">
        Consegna il passato
      </button>
      <div v-if="outcomes.late" class="notice" style="margin-top: 12px">
        <span class="badge" :class="badgeClass(outcomes.late.checkIn.provenance)">
          {{ outcomes.late.checkIn.provenance }}
        </span>
        <b style="margin-left: 6px">
          {{ outcomes.late.checkIn.accredited ? "accreditato" : "respinto" }}
        </b>
        <p style="font-size: 14px; margin-top: 6px">
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
