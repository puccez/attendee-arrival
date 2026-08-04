import { UpdateType } from "@powersync/web";
import type {
  AbstractPowerSyncDatabase,
  PowerSyncBackendConnector,
  PowerSyncCredentials,
} from "@powersync/web";
import { getDeviceId } from "../lib/device";

interface WalletOpData {
  event_id: string;
  kind: "code" | "arrival";
  value: string | null;
  collected_at: string | null;
  gps_inside: number | null;
  confirmation_tap: number | null;
  attendee_name: string | null;
}

/**
 * Connettore del borsellino: le credenziali le firma la nostra API
 * (sub = deviceId) e le consegne passano dalla cucitura di verifica —
 * mai scritture dirette al database.
 */
export class WalletConnector implements PowerSyncBackendConnector {
  constructor(private readonly apiBase: string) {}

  async fetchCredentials(): Promise<PowerSyncCredentials> {
    const res = await fetch(`${this.apiBase}/powersync-token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId: getDeviceId() }),
    });
    if (!res.ok) throw new Error(`powersync-token: HTTP ${res.status}`);
    const { token, endpoint } = (await res.json()) as {
      token: string;
      endpoint: string;
    };
    return { endpoint, token };
  }

  async uploadData(database: AbstractPowerSyncDatabase): Promise<void> {
    const transaction = await database.getNextCrudTransaction();
    if (!transaction) return;

    // Raggruppa gli item del borsellino per evento in un'unica consegna.
    const byEvent = new Map<
      string,
      {
        codes: { value: string; collectedAt: string }[];
        gpsInside: boolean;
        confirmationTap: boolean;
        attendeeName?: string;
      }
    >();
    for (const op of transaction.crud) {
      if (op.table !== "wallet_items" || op.op !== UpdateType.PUT) continue;
      const data = op.opData as unknown as WalletOpData;
      if (!data?.event_id) continue;
      let delivery = byEvent.get(data.event_id);
      if (!delivery) {
        delivery = { codes: [], gpsInside: false, confirmationTap: false };
        byEvent.set(data.event_id, delivery);
      }
      if (data.kind === "code" && data.value && data.collected_at) {
        delivery.codes.push({ value: data.value, collectedAt: data.collected_at });
      }
      delivery.gpsInside ||= data.gps_inside === 1;
      delivery.confirmationTap ||= data.confirmation_tap === 1;
      delivery.attendeeName = data.attendee_name ?? delivery.attendeeName;
    }

    try {
      for (const [eventId, d] of byEvent) {
        const res = await fetch(`${this.apiBase}/events/${eventId}/deliveries`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            deviceId: getDeviceId(),
            attendeeName: d.attendeeName || undefined,
            codes: d.codes,
            gps: d.gpsInside ? { insideGeofence: true } : undefined,
            confirmationTap: d.confirmationTap || undefined,
          }),
        });
        if (res.status >= 400 && res.status < 500) {
          // Errore permanente: logga e vai avanti — un 4xx non deve
          // bloccare la coda per sempre.
          console.error("consegna respinta", res.status, await res.text());
          continue;
        }
        if (!res.ok) throw new Error(`delivery: HTTP ${res.status}`);
      }
      await transaction.complete();
    } catch (error) {
      // Errore transiente (offline, 5xx): rilancia — PowerSync ritenta
      // con backoff. Questo È il borsellino che aspetta la rete.
      throw error;
    }
  }
}
