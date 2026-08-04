import { usePowerSync, useQuery, useStatus } from "@powersync/vue";
import type { ApiCheckIn } from "./useApi";
import { getAttendeeName, getDeviceId, setAttendeeName } from "../lib/device";

/**
 * Il borsellino dell'attendee su PowerSync: i Codici Rotanti si raccolgono
 * nella tabella locale wallet_items (funziona offline — la raccolta è
 * fotocamera/radio, non rete); la coda di upload li consegna alla cucitura
 * di verifica appena può. Lo stato etichettato torna giù dal sync stream
 * check_ins. La riga consegnata scompare dal borsellino: è il "consegnato".
 */
export function useWallet(eventId: string) {
  const powersync = usePowerSync();
  const status = useStatus();

  const deviceId = ref("");
  const attendeeName = ref("");
  onMounted(() => {
    deviceId.value = getDeviceId();
    attendeeName.value = getAttendeeName();
  });
  watch(attendeeName, (v) => setAttendeeName(v));

  // Item ancora nel borsellino = in attesa di consegna.
  const { data: pendingItems } = useQuery<{ value: string }>(
    "SELECT value FROM wallet_items WHERE event_id = ? AND kind = 'code'",
    [eventId],
  );

  // Lo stato sincronizzato dal server (provenienza × qualità).
  const { data: syncedRows } = useQuery<{ result: string }>(
    "SELECT result FROM check_ins WHERE event_id = ? AND device_id = ?",
    [eventId, deviceId],
  );
  const lastCheckIn = computed<ApiCheckIn | null>(() => {
    const raw = syncedRows.value[0]?.result;
    if (!raw) return null;
    try {
      return JSON.parse(raw) as ApiCheckIn;
    } catch {
      return null;
    }
  });

  async function collect(codeValue: string): Promise<boolean> {
    const db = powersync.value;
    const inWallet = await db.getOptional(
      "SELECT id FROM wallet_items WHERE event_id = ? AND value = ?",
      [eventId, codeValue],
    );
    if (inWallet) return false;
    await db.execute(
      `INSERT INTO wallet_items (id, event_id, kind, value, collected_at, attendee_name)
       VALUES (uuid(), ?, 'code', ?, ?, ?)`,
      [eventId, codeValue, new Date().toISOString(), attendeeName.value || null],
    );
    return true;
  }

  async function markArrival(opts: {
    gpsInside?: boolean;
    confirmationTap?: boolean;
  }): Promise<void> {
    await powersync.value.execute(
      `INSERT INTO wallet_items (id, event_id, kind, gps_inside, confirmation_tap, attendee_name)
       VALUES (uuid(), ?, 'arrival', ?, ?, ?)`,
      [
        eventId,
        opts.gpsInside ? 1 : 0,
        opts.confirmationTap ? 1 : 0,
        attendeeName.value || null,
      ],
    );
  }

  return {
    deviceId,
    attendeeName,
    pendingCodes: computed(() => pendingItems.value.map((i) => i.value)),
    lastCheckIn,
    online: computed(() => status.value.connected),
    uploading: computed(
      () => status.value.dataFlowStatus?.uploading === true,
    ),
    collect,
    markArrival,
  };
}
