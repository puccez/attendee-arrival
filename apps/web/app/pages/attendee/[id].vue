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
const geoDenied = ref(false);
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
      "La fotocamera non si apre (serve HTTPS o localhost). Puoi usare la scorciatoia qui sotto.";
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
      scanMessage.value = "Questo QR è di un altro evento.";
      return;
    }
    void wallet.collect(c).then((fresh) => {
      if (fresh) scanMessage.value = "Fatto ✓";
    });
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
  if (await wallet.collect(code)) {
    scanMessage.value = "[demo] preso ✓";
  } else {
    scanMessage.value = "[demo] già preso — il codice cambia fra 30 secondi";
  }
}

function confirmArrival() {
  void wallet.markArrival({ confirmationTap: true, gpsInside: arrived.value });
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
        geoDenied.value = false;
        const dist = haversineM(
          { lat: pos.coords.latitude, lng: pos.coords.longitude },
          fence,
        );
        arrived.value = dist <= fence.radiusM;
      },
      () => (geoDenied.value = true),
      { enableHighAccuracy: true },
    );
  }
});
onUnmounted(() => {
  stopScanner();
  if (geoWatch !== undefined) navigator.geolocation.clearWatch(geoWatch);
});

const checkIn = wallet.lastCheckIn;
const confermato = computed(() => checkIn.value?.accredited === true);

/** Loro scrivono «Mercoledì, 5 Agosto 2026»: iniziali maiuscole e la virgola
 *  dopo il giorno della settimana. L'italiano vorrebbe il minuscolo, ma qui
 *  stiamo somigliando a loro, non correggendoli. */
const giorno = computed(() => {
  if (!event.value) return "";
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
  if (!event.value) return "";
  const f = new Intl.DateTimeFormat("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${f.format(new Date(event.value.startsAt))} – ${f.format(new Date(event.value.endsAt))}`;
});

const luogo = computed(() => {
  if (!event.value?.geofence) return "Nessun raggio impostato per questo evento";
  if (geoDenied.value) return "Non riusciamo a leggere la tua posizione";
  return arrived.value
    ? "Ci sei dentro"
    : "Non sei ancora nel raggio dell'evento";
});

/**
 * Il vocabolario della verifica (provenienza, copertura, ritardo di consegna)
 * vive nella console dell'host e nella sandbox, dove è esattamente ciò che
 * vogliamo mostrare. Qui no: chi è a un aperitivo legge «Ci sei», non
 * «provenance: machine». docs/design.md §7.
 */
const stato = computed(() => {
  if (confermato.value) {
    const min = checkIn.value?.quality.coverageMinutes ?? 0;
    return {
      tono: "ok",
      titolo: "Ci sei",
      sotto:
        // «Confermati», non «sei qui da»: la copertura è il tempo sentito
        // davvero, un limite inferiore — non l'arco dall'arrivo.
        min >= 1
          ? `${min} minut${min === 1 ? "o" : "i"} di presenza confermati finora. Puoi rimettere il telefono in tasca.`
          : "Puoi rimettere il telefono in tasca.",
    };
  }
  if (wallet.pendingCodes.value.length > 0) {
    return wallet.online.value
      ? { tono: "attesa", titolo: "Ti stiamo riconoscendo", sotto: "Un attimo." }
      : {
          tono: "attesa",
          titolo: "Niente rete, nessun problema",
          sotto: "Resta tutto sul telefono e riparte da solo appena torna.",
        };
  }
  return {
    tono: "vuoto",
    titolo: "Non risulti ancora qui",
    sotto: arrived.value
      ? "Tocca «Confermo, sono qui» qui sotto."
      : "Avvicinati all'ingresso, oppure inquadra il QR del coordinatore.",
  };
});

const barra = computed(() => {
  if (confermato.value) return { etichetta: "Ci sei ✓", azione: null };
  if (arrived.value)
    return { etichetta: "Sei al WeMeet", azione: "conferma" as const };
  return { etichetta: "Non ancora confermato", azione: "qr" as const };
});
</script>

<template>
  <div class="page">
    <!-- Loro qui hanno una foto a tutto schermo. Le foto di WeRoad sono
         coperte da diritti e non le copiamo (design.md §9): resta la
         struttura — pastiglia di stato e titolo bianco in basso — su un
         fondo pieno scuro, che è il registro della loro schermata di lancio. -->
    <header class="hero">
      <NuxtLink class="hero-back" to="/" aria-label="Indietro">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18 9 12l6-6" /></svg>
      </NuxtLink>
      <div class="hero-foot">
        <span class="pill-on-photo">In corso</span>
        <h1 class="hero-title">{{ event?.name || "WeMeet" }}</h1>
      </div>
    </header>

    <!-- La card che risale sopra la foto: è la forma esatta del dettaglio
         evento dell'app, e porta la stessa informazione più «da quanto sei qui». -->
    <section class="sheet">
      <div class="info">
        <span class="tile">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M8 3v4M16 3v4M3 10h18" /></svg>
        </span>
        <div>
          <p class="info-strong">{{ giorno || "Data da definire" }}</p>
          <p class="info-sub">{{ orario }}</p>
        </div>
      </div>

      <div class="info">
        <span class="tile">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z" /><circle cx="12" cy="10" r="2.6" /></svg>
        </span>
        <div>
          <p class="info-strong">Il posto dell'evento</p>
          <p class="info-sub">{{ luogo }}</p>
        </div>
      </div>

      <div class="info">
        <span class="tile">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.6" /><path d="M4.5 20a7.5 7.5 0 0 1 15 0" /></svg>
        </span>
        <div>
          <p class="info-strong">Ciao,</p>
          <input
            v-model="wallet.attendeeName.value"
            class="name-inline"
            placeholder="scrivi il tuo nome"
            aria-label="Il tuo nome"
          />
        </div>
      </div>
    </section>

    <section class="card status" :class="stato.tono">
      <span class="dot"></span>
      <div>
        <p class="status-title">{{ stato.titolo }}</p>
        <p class="status-sub">{{ stato.sotto }}</p>
      </div>
    </section>

    <section class="card">
      <p class="card-title">Il codice del coordinatore</p>
      <p class="card-sub">
        Se non parte da solo, inquadra il QR sullo schermo di chi conduce
        l'evento.
      </p>
      <div class="actions">
        <button v-if="!scanning" class="ghost" @click="startScanner">
          Apri la fotocamera
        </button>
        <button v-else class="ghost" @click="stopScanner">Chiudi</button>
        <button class="ghost" @click="simulateScan">Scorciatoia demo</button>
      </div>
      <video v-show="scanning" ref="video" playsinline class="viewfinder"></video>
      <p v-if="scanMessage" class="card-sub scan-msg">{{ scanMessage }}</p>
    </section>

    <!-- Chi guarda la demo ha bisogno di vedere le etichette vere; chi è
         all'aperitivo no. Chiuse per default: sono un retroscena, non la
         schermata. -->
    <details class="backstage">
      <summary>Dietro le quinte (demo)</summary>
      <dl v-if="checkIn">
        <dt>provenienza</dt><dd>{{ checkIn.provenance }}</dd>
        <dt>codici validi</dt><dd>{{ checkIn.quality.validCodes }}</dd>
        <dt>copertura</dt><dd>{{ checkIn.quality.coverageMinutes }} min</dd>
        <dt>buco massimo</dt><dd>{{ checkIn.quality.longestGapMinutes }} min</dd>
        <dt>ritardo di consegna</dt><dd>{{ checkIn.quality.deliveryLagMinutes }} min</dd>
        <dt>accreditato</dt><dd>{{ checkIn.accredited ? "sì" : "no" }}</dd>
      </dl>
      <p v-else class="card-sub">
        Nessuna consegna ancora verificata dal server.
      </p>
      <p class="card-sub">
        borsellino: {{ wallet.pendingCodes.value.length }} in attesa ·
        sync {{ wallet.online.value ? "connesso" : "disconnesso" }}
      </p>
    </details>

    <!-- Barra d'azione fissa a pastiglia galleggiante: nell'app è il posto
         dell'azione principale, e la conferma one-tap è la nostra. -->
    <div class="actionbar">
      <span class="actionbar-label">{{ barra.etichetta }}</span>
      <button v-if="barra.azione === 'conferma'" class="round" @click="confirmArrival">
        Confermo, sono qui
      </button>
      <button
        v-else-if="barra.azione === 'qr'"
        class="round"
        @click="scanning ? stopScanner() : startScanner()"
      >
        Inquadra il QR
      </button>
      <button v-else class="round" disabled>Confermato</button>
    </div>
  </div>
</template>

<style scoped>
.page {
  padding-bottom: 120px;
}

/* --- testata --- */
.hero {
  position: relative;
  height: 260px;
  /* Il velo corallo in alto a destra evita che il blocco pieno si legga come
     un'immagine che non è arrivata: è una superficie, non un buco. */
  background:
    radial-gradient(90% 70% at 88% 0%, rgba(255, 71, 88, 0.35) 0%, transparent 60%),
    radial-gradient(120% 90% at 20% 100%, #2f2f2f 0%, #171717 70%);
  display: flex;
  align-items: flex-end;
  padding: 16px;
}
.hero-back {
  position: absolute;
  top: 16px;
  left: 16px;
  color: #fff;
  display: flex;
}
.hero-foot {
  padding-bottom: 40px;
}
.pill-on-photo {
  display: inline-block;
  background: var(--surface);
  color: var(--ink-strong);
  font-size: 14px;
  font-weight: 500;
  border-radius: var(--r-full);
  padding: 6px 14px;
}
.hero-title {
  color: #fff;
  font-size: 32px;
  line-height: 34px;
  font-weight: 700;
  margin: 8px 0 0;
}

/* --- card bianche, senza bordo: si staccano dalla sabbia per contrasto --- */
.sheet,
.card {
  background: var(--surface);
  border-radius: var(--r-card);
  margin: 0 16px 16px;
  padding: 16px;
}
.sheet {
  margin-top: -24px;
  position: relative;
}

.info {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 6px 0;
}
.tile {
  flex: none;
  width: 44px;
  height: 44px;
  border-radius: 14px;
  background: var(--tile);
  color: var(--ink-strong);
  display: grid;
  place-items: center;
}
.info-strong {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  color: var(--ink-strong);
}
.info-sub {
  margin: 0;
  font-size: 15px;
  color: var(--muted);
}

/* Il luogo, nell'app, è testo sottolineato e toccabile. Qui il nome è
   l'unica cosa che l'attendee scrive: prende quella forma. */
.name-inline {
  width: 100%;
  border: 0;
  border-bottom: 1px solid var(--line);
  border-radius: 0;
  padding: 2px 0;
  font-size: 15px;
  color: var(--ink-strong);
  background: transparent;
}
.name-inline:focus-visible {
  outline: 0;
  border-bottom-color: var(--brand);
}

/* --- stato --- */
.status {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.dot {
  flex: none;
  width: 10px;
  height: 10px;
  border-radius: var(--r-full);
  margin-top: 8px;
  background: var(--faint);
}
.status.ok .dot {
  background: var(--ok);
}
.status.attesa .dot {
  background: var(--warn);
}
.status-title {
  margin: 0;
  font-size: 20px;
  line-height: 24px;
  font-weight: 700;
  color: var(--ink);
}
.status-sub {
  margin: 4px 0 0;
  font-size: 15px;
  color: var(--muted);
}

.card-title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  color: var(--ink-strong);
}
.card-sub {
  margin: 4px 0 0;
  font-size: 15px;
  color: var(--muted);
}
.scan-msg {
  color: var(--ink-strong);
}

.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 12px;
}
/* Nell'app tutto ciò che si tocca è completamente arrotondato. */
.ghost {
  background: var(--surface-sunken);
  color: var(--ink-strong);
  border-radius: var(--r-full);
  height: 40px;
  font-size: 15px;
}
.viewfinder {
  width: 100%;
  border-radius: var(--r-card);
  margin-top: 12px;
}

.backstage {
  margin: 0 16px;
  font-size: 14px;
  color: var(--muted);
}
.backstage summary {
  cursor: pointer;
  padding: 8px 0;
}
.backstage dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 12px;
  margin: 4px 0;
  font-family: "SF Mono", ui-monospace, Menlo, Consolas, monospace;
  font-size: 13px;
}
.backstage dt {
  color: var(--faint);
}
.backstage dd {
  margin: 0;
  color: var(--ink-strong);
}

/* --- barra d'azione --- */
.actionbar {
  position: fixed;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  width: min(398px, calc(100% - 32px));
  background: var(--surface);
  border-radius: var(--r-full);
  padding: 8px 8px 8px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  box-shadow: 0 2px 16px rgba(23, 23, 23, 0.08);
}
.actionbar-label {
  font-size: 16px;
  color: var(--ink-strong);
}
.round {
  border-radius: var(--r-full);
  height: 48px;
  white-space: nowrap;
}
</style>
