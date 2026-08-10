<script setup lang="ts">
import { useApi, type ApiEvent } from "../composables/useApi";

const api = useApi();
const router = useRouter();

const name = ref("WeMeet demo");
const useMyPosition = ref(true);
const creating = ref(false);
const error = ref("");

const events = ref<ApiEvent[]>([]);
const deletingId = ref("");

async function refreshEvents() {
  try {
    events.value = await api.get<ApiEvent[]>("/events");
  } catch {
    // la lista può mancare: la creazione deve restare possibile lo stesso
  }
}

async function createEvent() {
  creating.value = true;
  error.value = "";
  try {
    let geofence: ApiEvent["geofence"];
    if (useMyPosition.value && "geolocation" in navigator) {
      try {
        const pos = await new Promise<GeolocationPosition>((res, rej) =>
          navigator.geolocation.getCurrentPosition(res, rej, {
            timeout: 8000,
          }),
        );
        geofence = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          radiusM: 150,
        };
      } catch {
        // niente permesso/segnale: l'evento nasce senza geofence
      }
    }
    const now = Date.now();
    const event = await api.post<ApiEvent>("/events", {
      name: name.value,
      startsAt: new Date(now - 10 * 60_000).toISOString(),
      endsAt: new Date(now + 4 * 60 * 60_000).toISOString(),
      geofence,
    });
    await router.push(`/console/${event.id}`);
  } catch (e) {
    error.value = `API non raggiungibile: ${String(e)}`;
  } finally {
    creating.value = false;
  }
}

/** Loro scrivono «Mercoledì, 5 Agosto 2026»: iniziali maiuscole e la virgola
 *  dopo il giorno — la stessa riga della console, per la stessa ragione. */
function quando(e: ApiEvent) {
  const inizio = new Date(e.startsAt);
  const parti = new Intl.DateTimeFormat("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).formatToParts(inizio);
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const get = (t: string) => parti.find((p) => p.type === t)?.value ?? "";
  const ora = new Intl.DateTimeFormat("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${cap(get("weekday"))}, ${get("day")} ${cap(get("month"))} ${get("year")} ‧ ${ora.format(inizio)} – ${ora.format(new Date(e.endsAt))}`;
}

/**
 * La finestra nativa basta, per una demo: quello che va curato è la frase
 * dentro — parla degli arrivi che se ne vanno, non delle tabelle.
 */
async function removeEvent(e: ApiEvent) {
  if (!confirm(`Eliminare «${e.name}»? Se ne vanno anche i suoi arrivi.`)) {
    return;
  }
  deletingId.value = e.id;
  error.value = "";
  try {
    await api.del(`/events/${e.id}`);
    await refreshEvents();
  } catch (err) {
    error.value = `API non raggiungibile: ${String(err)}`;
  } finally {
    deletingId.value = "";
  }
}

onMounted(refreshEvents);
</script>

<template>
  <div>
    <div class="eyebrow">WeMeet check-in · demo</div>
    <h1>La posizione si dichiara, la prossimità si dimostra</h1>
    <p class="muted">
      Crea un evento demo: il tuo schermo diventa il venue (console con QR
      rotante), il tuo telefono l'attendee. Poi prova a fregare il sistema.
    </p>

    <div class="panel">
      <div class="row">
        <div>
          <label for="name">Nome evento</label>
          <input id="name" v-model="name" />
        </div>
        <div style="flex: 0 0 auto; min-width: 0">
          <label style="white-space: nowrap">
            <input
              v-model="useMyPosition"
              type="checkbox"
              style="width: auto; margin-right: 6px"
            />
            geofence qui (150 m)
          </label>
          <button
            :disabled="creating"
            style="white-space: nowrap"
            @click="createEvent"
          >
            {{ creating ? "Creo…" : "Crea evento demo qui" }}
          </button>
        </div>
      </div>
    </div>

    <div class="panel">
      <h2>Riprendi un evento</h2>
      <p v-if="events.length === 0" class="muted">
        Nessun evento, per ora: il primo si crea qui sopra.
      </p>
      <ul v-else class="events">
        <li v-for="e in events" :key="e.id" class="event-row">
          <div>
            <div class="event-name">{{ e.name }}</div>
            <div class="event-when">{{ quando(e) }}</div>
          </div>
          <div class="event-actions">
            <NuxtLink :to="`/console/${e.id}`">console</NuxtLink>
            <span class="sep">‧</span>
            <NuxtLink :to="`/attendee/${e.id}`">vista attendee</NuxtLink>
            <button
              class="delete"
              :disabled="deletingId === e.id"
              @click="removeEvent(e)"
            >
              {{ deletingId === e.id ? "Elimino…" : "Elimina" }}
            </button>
          </div>
        </li>
      </ul>
    </div>

    <p v-if="error" class="notice">{{ error }}</p>
  </div>
</template>

<style scoped>
.events {
  list-style: none;
  margin: 0;
  padding: 0;
}
.event-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 16px;
  padding: 12px 0;
  border-bottom: 1px solid var(--line);
}
.event-row:last-child {
  border-bottom: 0;
  padding-bottom: 4px;
}
.event-name {
  font-size: 16px;
  line-height: 24px;
  font-weight: 600;
  color: var(--ink-strong);
}
.event-when {
  font-size: 14px;
  line-height: 20px;
  color: var(--muted);
}
.event-actions {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
}
.sep {
  color: var(--faint);
}
/* Distruttivo ma non protagonista: il corallo dice «ci si clicca» (design.md
   §2), il corpo da link lo tiene un gradino sotto i due che portano dentro.
   Il pieno resta al bottone che crea. */
button.delete {
  background: none;
  color: var(--brand);
  border: 1px solid transparent;
  border-radius: var(--r-control);
  height: auto;
  padding: 4px 10px;
  font-size: 14px;
  font-weight: 500;
  margin-left: 6px;
}
button.delete:hover {
  border-color: var(--line);
}
button.delete:disabled {
  background: none;
  color: var(--brand-soft);
}
</style>
