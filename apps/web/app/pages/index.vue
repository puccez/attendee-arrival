<script setup lang="ts">
import { useApi, type ApiEvent } from "../composables/useApi";

const api = useApi();
const router = useRouter();

const name = ref("WeMeet demo");
const useMyPosition = ref(true);
const creating = ref(false);
const error = ref("");

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
        <div style="flex: 0">
          <label style="white-space: nowrap">
            <input
              v-model="useMyPosition"
              type="checkbox"
              style="width: auto; margin-right: 6px"
            />
            geofence qui (150 m)
          </label>
          <button :disabled="creating" @click="createEvent">
            {{ creating ? "Creo…" : "Crea evento demo qui" }}
          </button>
        </div>
      </div>
      <p v-if="error" class="notice">{{ error }}</p>
    </div>
  </div>
</template>
