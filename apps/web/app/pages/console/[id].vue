<script setup lang="ts">
import QRCode from "qrcode";
import { useApi, type ApiCheckIn, type ApiEvent } from "../../composables/useApi";

const route = useRoute();
const eventId = route.params.id as string;
const api = useApi();

const codeCanvas = ref<HTMLCanvasElement>();
const joinCanvas = ref<HTMLCanvasElement>();
const currentCode = ref("······");
const event = ref<ApiEvent | null>(null);
const checkIns = ref<ApiCheckIn[]>([]);
const beaconStartedAt = Date.now();
const nowTick = ref(Date.now());

const attendeeUrl = computed(
  () => `${location.origin}/attendee/${eventId}`,
);
const beaconMinutes = computed(() =>
  Math.floor((nowTick.value - beaconStartedAt) / 60_000),
);

/** Loro scrivono «Mercoledì, 5 Agosto 2026»: iniziali maiuscole e la virgola
 *  dopo il giorno. Stiamo somigliando a loro, non correggendoli. */
const giorno = computed(() => {
  if (!event.value) return null;
  const parti = new Intl.DateTimeFormat("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).formatToParts(new Date(event.value.startsAt));
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const get = (t: string) => parti.find((p) => p.type === t)?.value ?? "";
  return `${cap(get("weekday"))}, ${get("day")} ${cap(get("month"))} ${get("year")}`;
});
const orario = computed(() => {
  if (!event.value) return null;
  const f = new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit" });
  return `${f.format(new Date(event.value.startsAt))} – ${f.format(new Date(event.value.endsAt))}`;
});

/**
 * L'avatar della riga: iniziale su tinta pastello, inchiostro saturo della
 * stessa famiglia — la regola delle tessere di categoria (design.md §2),
 * scelta in modo stabile dal nome.
 */
const AVATAR_TINTS = [
  { bg: "#fff6dd", ink: "#a85b48" },
  { bg: "#e7f2ff", ink: "#5a60d1" },
  { bg: "#e3f2fe", ink: "#1a86c3" },
  { bg: "#ddeff0", ink: "#2d454c" },
] as const;
function avatarFor(c: ApiCheckIn) {
  const label = c.attendeeName || c.deviceId;
  let hash = 0;
  for (const ch of label) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
  return {
    ...AVATAR_TINTS[hash % AVATAR_TINTS.length]!,
    // Primo code point, non primo char: un nome che inizia con un'emoji
    // (la sandbox li usa) con charAt mostrerebbe mezzo surrogato.
    initial: ([...(c.attendeeName?.trim() ?? "")][0] ?? "·").toUpperCase(),
  };
}

async function refreshCode() {
  try {
    const { code } = await api.get<{ code: string }>(
      `/events/${eventId}/code`,
    );
    currentCode.value = code;
    if (codeCanvas.value) {
      await QRCode.toCanvas(
        codeCanvas.value,
        JSON.stringify({ e: eventId, c: code }),
        { width: 260, margin: 1 },
      );
    }
  } catch {
    currentCode.value = "——————";
  }
}

async function refreshCheckIns() {
  try {
    checkIns.value = await api.get<ApiCheckIn[]>(
      `/events/${eventId}/check-ins`,
    );
  } catch {
    /* riproveremo al prossimo giro */
  }
}

// La testimonianza ha una porta sua: è un'azione dell'host su una persona,
// non qualcosa che il borsellino dell'attendee possa dichiarare da solo.
async function attestManually(deviceId: string) {
  await api.post(`/events/${eventId}/attestations`, { deviceId });
  await refreshCheckIns();
}

function badgeClass(p: ApiCheckIn["provenance"]) {
  return p === "machine+human"
    ? "both"
    : p === "machine"
      ? "machine"
      : p === "human"
        ? "human"
        : "none";
}

let timers: ReturnType<typeof setInterval>[] = [];
onMounted(() => {
  void api
    .get<ApiEvent>(`/events/${eventId}`)
    .then((e) => (event.value = e))
    .catch(() => {}); /* la console resta usabile anche senza dettagli */
  void refreshCode();
  void refreshCheckIns();
  timers = [
    setInterval(refreshCode, 2000),
    setInterval(refreshCheckIns, 2000),
    setInterval(() => (nowTick.value = Date.now()), 10_000),
  ];
  if (joinCanvas.value) {
    void QRCode.toCanvas(joinCanvas.value, attendeeUrl.value, {
      width: 130,
      margin: 1,
    });
  }
});
onUnmounted(() => timers.forEach(clearInterval));
</script>

<template>
  <div>
    <div class="eyebrow">Console dell'evento · beacon-notaio</div>
    <h1>{{ event?.name ?? "Il venue sei tu" }}</h1>
    <!-- La riga meta con le icone: la struttura della card di lista del loro
         web (design.md §5), separatore ‧ compreso. -->
    <p class="meta">
      <span v-if="giorno" class="meta-item">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M8 3v4M16 3v4M3 10h18" /></svg>
        {{ giorno }}
      </span>
      <span v-if="orario" class="meta-sep">‧</span>
      <span v-if="orario" class="meta-item">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
        {{ orario }}
      </span>
      <span class="meta-sep">‧</span>
      <span class="meta-item">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 9a8 8 0 0 1 14 0M8 12a4.5 4.5 0 0 1 8 0" /><circle cx="12" cy="16" r="1.6" /></svg>
        beacon attivo da {{ beaconMinutes }} min
      </span>
    </p>

    <div class="row" style="align-items: stretch">
      <div class="panel" style="text-align: center; flex: 1">
        <h2>Il venue sei tu</h2>
        <p class="muted" style="font-size: 14px">
          Questo schermo emette il Codice Rotante (canale ottico).
        </p>
        <canvas ref="codeCanvas"></canvas>
        <div class="code-digits">{{ currentCode }}</div>
        <!-- Qui c'era «screenshottarlo non serve a niente»: non è vero, ed è
             la stessa frase che abbiamo corretto nel documento. Uno screenshot
             inoltrato è spendibile finché è aperta la finestra di consegna —
             quello che non può nascondere è il ritardo. Vedi la sandbox. -->
        <p class="muted" style="font-size: 13px">
          cambia ogni 30 secondi, e ogni codice si porta dietro il minuto in
          cui è nato
        </p>
      </div>

      <div class="panel" style="flex: 1">
        <h2>Fai entrare un attendee</h2>
        <p class="muted" style="font-size: 14px">
          Apri sul telefono (stessa rete) o inquadra:
        </p>
        <canvas ref="joinCanvas"></canvas>
        <p style="font-size: 13px; word-break: break-all">
          <a :href="attendeeUrl">{{ attendeeUrl }}</a>
        </p>
        <p style="font-size: 13px">
          Oppure prova a fregarlo:
          <NuxtLink :to="`/attacker/${eventId}`">sandbox d'attacco</NuxtLink>
        </p>
      </div>
    </div>

    <div class="panel">
      <h2>
        Arrivi in tempo reale
        <span v-if="checkIns.length > 0" class="muted count">· {{ checkIns.length }}</span>
      </h2>
      <p v-if="checkIns.length === 0" class="muted">
        Ancora nessuna consegna. Apri la vista attendee e scansiona il QR.
      </p>
      <table v-else>
        <thead>
          <tr>
            <th>Attendee</th>
            <th>Provenienza</th>
            <th>Codici</th>
            <th>Copertura</th>
            <th>Buco max</th>
            <th>Ritardo</th>
            <th>Tap</th>
            <th>Accreditato</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in checkIns" :key="c.deviceId">
            <td>
              <span class="who">
                <span
                  class="avatar"
                  :style="{
                    background: avatarFor(c).bg,
                    color: avatarFor(c).ink,
                  }"
                  >{{ avatarFor(c).initial }}</span
                >
                {{ c.attendeeName || c.deviceId.slice(0, 8) }}
              </span>
            </td>
            <td>
              <span class="badge" :class="badgeClass(c.provenance)">{{
                c.provenance
              }}</span>
            </td>
            <td>{{ c.quality.validCodes }}</td>
            <td
              title="Tempo campionato: gli intervalli fra un codice e il successivo, accreditati al massimo 10 minuti ciascuno. È un limite inferiore — mai più di quanto il telefono abbia davvero sentito."
            >
              {{ c.quality.coverageMinutes }} min
            </td>
            <td>
              {{ c.quality.longestGapMinutes }} min
              <span
                v-if="c.quality.longestGapMinutes >= 10"
                class="muted"
                style="font-size: 12px"
                title="Fra due codici è passato molto tempo: può essersi allontanato, o può essere il telefono che dormiva."
                >⚠</span
              >
            </td>
            <td
              title="Quanto era vecchia la prova più vecchia quando è arrivata. Chi è qui consegna in diretta; una prova inoltrata da un complice si porta dietro il ritardo. Non distingue il complice da chi è rimasto offline tutta la sera: sono lo stesso fatto visto da qui."
            >
              {{ c.quality.deliveryLagMinutes }} min
              <span
                v-if="c.quality.deliveryLagMinutes >= 30"
                class="muted"
                style="font-size: 12px"
                >⚠</span
              >
            </td>
            <td>{{ c.quality.tappedNotification ? "✓" : "—" }}</td>
            <td>{{ c.accredited ? "✓" : "✗" }}</td>
            <td>
              <button
                v-if="c.provenance === 'none' || c.provenance === 'machine'"
                class="secondary"
                style="padding: 4px 10px; font-size: 12px; height: auto; white-space: nowrap"
                @click="attestManually(c.deviceId)"
              >
                Testimonia di persona
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
/* La riga meta del loro web: icone in linea, separatore ‧ (U+2027). */
.meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--muted);
  font-size: 14px;
  margin: 0 0 8px;
}
.meta-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.meta-sep {
  color: var(--faint);
}
.count {
  font-size: 16px;
  font-weight: 500;
}

/* La pila di avatar, per riga: iniziale su tinta pastello (design.md §2). */
.who {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.avatar {
  width: 28px;
  height: 28px;
  border-radius: 9px; /* quadrato arrotondato, come i loro avatar */
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
}
</style>
