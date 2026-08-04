<script setup lang="ts">
import jsQR from "jsqr";
import { useApi, type ApiEvent } from "../../composables/useApi";
import { useWallet } from "../../composables/useWallet";

const route = useRoute();
const eventId = route.params.id as string;
const api = useApi();
const wallet = useWallet(eventId);

const event = ref<ApiEvent | null>(null);
const scanning = ref(false);
const scanMessage = ref("");
const arrived = ref(false);
const video = ref<HTMLVideoElement>();

let stream: MediaStream | null = null;
let scanLoop: number | undefined;
let geoWatch: number | undefined;

async function startScanner() {
  scanMessage.value = "";
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
    });
  } catch {
    scanMessage.value =
      "Fotocamera non disponibile (serve HTTPS o localhost). Usa la simulazione qui sotto.";
    return;
  }
  scanning.value = true;
  await nextTick();
  if (!video.value) return;
  video.value.srcObject = stream;
  await video.value.play();

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const tick = () => {
    if (!scanning.value || !video.value) return;
    if (video.value.readyState === video.value.HAVE_ENOUGH_DATA) {
      canvas.width = video.value.videoWidth;
      canvas.height = video.value.videoHeight;
      ctx.drawImage(video.value, 0, 0);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const qr = jsQR(img.data, img.width, img.height);
      if (qr) onScanned(qr.data);
    }
    scanLoop = requestAnimationFrame(tick);
  };
  scanLoop = requestAnimationFrame(tick);
}

function stopScanner() {
  scanning.value = false;
  if (scanLoop) cancelAnimationFrame(scanLoop);
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}

function onScanned(payload: string) {
  try {
    const { e, c } = JSON.parse(payload) as { e: string; c: string };
    if (e !== eventId) {
      scanMessage.value = "QR di un altro evento (back-to-back?): ignorato.";
      return;
    }
    if (wallet.collect(c)) {
      scanMessage.value = `Codice ${c} raccolto nel borsellino ✓`;
    }
  } catch {
    /* QR estraneo: ignora */
  }
}

/**
 * Scorciatoia dichiarata della demo: al venue questo codice ti arriverebbe
 * dal QR della console o dal beacon BLE — qui lo chiediamo al server.
 */
async function simulateScan() {
  const { code } = await api.get<{ code: string }>(`/events/${eventId}/code`);
  if (wallet.collect(code)) {
    scanMessage.value = `[simulazione] codice ${code} raccolto ✓`;
  } else {
    scanMessage.value =
      "[simulazione] codice già in borsellino — aspetta la prossima finestra (30 s)";
  }
}

function confirmArrival() {
  wallet.markArrival({ confirmationTap: true, gpsInside: arrived.value });
}

function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

onMounted(async () => {
  try {
    event.value = await api.get<ApiEvent>(`/events/${eventId}`);
  } catch {
    /* la pagina resta usabile anche senza dettagli evento */
  }
  const fence = event.value?.geofence;
  if (fence && "geolocation" in navigator) {
    geoWatch = navigator.geolocation.watchPosition(
      (pos) => {
        const dist = haversineM(
          { lat: pos.coords.latitude, lng: pos.coords.longitude },
          fence,
        );
        arrived.value = dist <= fence.radiusM;
      },
      () => {},
      { enableHighAccuracy: true },
    );
  }
});
onUnmounted(() => {
  stopScanner();
  if (geoWatch !== undefined) navigator.geolocation.clearWatch(geoWatch);
});

const provenanceLabel = computed(() => {
  const c = wallet.lastCheckIn.value;
  if (!c) return null;
  return c;
});
</script>

<template>
  <div>
    <div class="eyebrow">Vista attendee</div>
    <h1>{{ event?.name || "WeMeet" }}</h1>

    <div class="panel">
      <label for="nm">Il tuo nome</label>
      <input id="nm" v-model="wallet.attendeeName.value" placeholder="Anna" />
    </div>

    <div v-if="arrived" class="notice">
      <b>Sei arrivata al venue</b> (geofence GPS — contesto, non prova).
      <button style="margin-left: 8px" @click="confirmArrival">
        Confermo, sono qui
      </button>
    </div>

    <div class="panel">
      <h2>Prova di prossimità</h2>
      <p class="muted" style="font-size: 14px">
        Inquadra il QR rotante della console. Ogni scansione in più fa
        crescere la tua permanenza (dwell).
      </p>
      <div class="row">
        <button v-if="!scanning" @click="startScanner">Apri fotocamera</button>
        <button v-else class="secondary" @click="stopScanner">
          Chiudi fotocamera
        </button>
        <button class="secondary" @click="simulateScan">
          Simula scansione (demo)
        </button>
      </div>
      <video
        v-show="scanning"
        ref="video"
        playsinline
        style="width: 100%; max-width: 420px; border-radius: 8px; margin-top: 12px"
      ></video>
      <p v-if="scanMessage" style="font-size: 14px">{{ scanMessage }}</p>
    </div>

    <div class="panel">
      <h2>Il tuo borsellino</h2>
      <p class="muted" style="font-size: 14px">
        {{ wallet.codes.value.length }} codici raccolti ·
        <span v-if="wallet.online.value">consegnati al server ✓</span>
        <span v-else style="color: var(--warn)">
          offline — restano qui e si consegnano appena torna la rete
        </span>
      </p>
      <div v-if="provenanceLabel">
        <span
          class="badge"
          :class="{
            machine: provenanceLabel.provenance === 'machine',
            both: provenanceLabel.provenance === 'machine+human',
            human: provenanceLabel.provenance === 'human',
            none: provenanceLabel.provenance === 'none',
          }"
        >
          {{ provenanceLabel.provenance }}
        </span>
        <span style="font-size: 14px; margin-left: 8px">
          {{ provenanceLabel.quality.validCodes }} codici validi ·
          {{ provenanceLabel.quality.coverageMinutes }} min di permanenza
          {{ provenanceLabel.accredited ? "· accreditato ✓" : "· non accreditato" }}
        </span>
      </div>
    </div>
  </div>
</template>
