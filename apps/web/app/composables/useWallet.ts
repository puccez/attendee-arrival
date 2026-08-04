import { useApi, type ApiCheckIn } from "./useApi";

interface WalletCode {
  value: string;
  collectedAt: string;
}

interface WalletState {
  codes: WalletCode[];
  pendingFlags: { gpsInside: boolean; confirmationTap: boolean };
}

/**
 * Il borsellino dell'attendee: raccoglie i Codici Rotanti in locale
 * (funziona offline — la raccolta è fotocamera, non rete) e li consegna
 * al server appena può. v1 su localStorage; il passaggio a PowerSync
 * mantiene questa stessa interfaccia.
 */
export function useWallet(eventId: string) {
  const api = useApi();
  const deviceId = useLocalStorage("device-id", () => crypto.randomUUID());
  const attendeeName = useLocalStorage("attendee-name", () => "");
  const storageKey = `wallet:${eventId}`;

  const state = ref<WalletState>(
    readJson<WalletState>(storageKey) ?? {
      codes: [],
      pendingFlags: { gpsInside: false, confirmationTap: false },
    },
  );
  const lastCheckIn = ref<ApiCheckIn | null>(null);
  const online = ref(true);
  const pendingDelivery = ref(false);

  function persist() {
    localStorage.setItem(storageKey, JSON.stringify(state.value));
  }

  function collect(codeValue: string) {
    if (state.value.codes.some((c) => c.value === codeValue)) return false;
    state.value.codes.push({
      value: codeValue,
      collectedAt: new Date().toISOString(),
    });
    persist();
    void flush();
    return true;
  }

  function markArrival(opts: { gpsInside?: boolean; confirmationTap?: boolean }) {
    state.value.pendingFlags.gpsInside ||= opts.gpsInside === true;
    state.value.pendingFlags.confirmationTap ||= opts.confirmationTap === true;
    persist();
    void flush();
  }

  /** Consegna tutto il borsellino: il server accumula e ri-valuta l'unione. */
  async function flush() {
    if (pendingDelivery.value) return;
    pendingDelivery.value = true;
    try {
      lastCheckIn.value = await api.post<ApiCheckIn>(
        `/events/${eventId}/deliveries`,
        {
          deviceId: deviceId.value,
          attendeeName: attendeeName.value || undefined,
          codes: state.value.codes,
          gps: state.value.pendingFlags.gpsInside
            ? { insideGeofence: true }
            : undefined,
          confirmationTap: state.value.pendingFlags.confirmationTap || undefined,
        },
      );
      online.value = true;
    } catch {
      online.value = false; // resta nel borsellino: riproveremo
    } finally {
      pendingDelivery.value = false;
    }
  }

  let retryTimer: ReturnType<typeof setInterval> | undefined;
  onMounted(() => {
    window.addEventListener("online", flush);
    retryTimer = setInterval(() => {
      if (!online.value && state.value.codes.length > 0) void flush();
    }, 4000);
  });
  onUnmounted(() => {
    window.removeEventListener("online", flush);
    if (retryTimer) clearInterval(retryTimer);
  });

  return {
    deviceId,
    attendeeName,
    codes: computed(() => state.value.codes),
    lastCheckIn,
    online,
    collect,
    markArrival,
    flush,
  };
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function useLocalStorage(key: string, init: () => string) {
  const value = ref(localStorage.getItem(key) ?? init());
  watch(value, (v) => localStorage.setItem(key, v), { immediate: true });
  return value;
}
