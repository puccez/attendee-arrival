<script setup lang="ts">
import QRCode from "qrcode";
import { useApi, type ApiCheckIn } from "../../composables/useApi";

const route = useRoute();
const eventId = route.params.id as string;
const api = useApi();

const codeCanvas = ref<HTMLCanvasElement>();
const joinCanvas = ref<HTMLCanvasElement>();
const currentCode = ref("······");
const checkIns = ref<ApiCheckIn[]>([]);
const beaconStartedAt = Date.now();
const nowTick = ref(Date.now());

const attendeeUrl = computed(
  () => `${location.origin}/attendee/${eventId}`,
);
const beaconMinutes = computed(() =>
  Math.floor((nowTick.value - beaconStartedAt) / 60_000),
);

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

async function attestManually(deviceId: string) {
  await api.post(`/events/${eventId}/deliveries`, {
    deviceId,
    codes: [],
    hostAttested: true,
  });
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
    <h1>Il venue sei tu</h1>
    <p class="muted">
      Questo schermo emette il Codice Rotante (canale ottico). Battito del
      beacon: attivo da {{ beaconMinutes }} min.
    </p>

    <div class="row" style="align-items: stretch">
      <div class="panel" style="text-align: center; flex: 1">
        <h2>Codice Rotante</h2>
        <canvas ref="codeCanvas"></canvas>
        <div class="code-digits">{{ currentCode }}</div>
        <p class="muted" style="font-size: 13px">
          ruota ogni 30 secondi — screenshottarlo non serve a niente
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
      </div>
    </div>

    <div class="panel">
      <h2>Arrivi in tempo reale</h2>
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
            <th>Tap</th>
            <th>Accreditato</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in checkIns" :key="c.deviceId">
            <td>
              {{ c.attendeeName || c.deviceId.slice(0, 8) }}
            </td>
            <td>
              <span class="badge" :class="badgeClass(c.provenance)">{{
                c.provenance
              }}</span>
            </td>
            <td>{{ c.quality.validCodes }}</td>
            <td>{{ c.quality.coverageMinutes }} min</td>
            <td>{{ c.quality.tappedNotification ? "✓" : "—" }}</td>
            <td>{{ c.accredited ? "✓" : "✗" }}</td>
            <td>
              <button
                v-if="c.provenance === 'none' || c.provenance === 'machine'"
                class="secondary"
                style="padding: 4px 10px; font-size: 12px"
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
