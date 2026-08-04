/**
 * Il borsellino → la cucitura di verifica.
 *
 * Gemello di `apps/web/app/powersync/connector.ts`: gli item raccolti si
 * raggruppano per evento in un'unica consegna e salgono a
 * POST /events/:id/deliveries. È l'unico modo di scrivere: mai scritture
 * dirette al database, mai logica di fiducia sul client.
 *
 * Modulo puro: nessun import React Native, testabile con `npm test`.
 */

export interface WalletItem {
  id: string;
  eventId: string;
  /** 'code' = un Codice Rotante raccolto; 'arrival' = contesto (GPS, tap). */
  kind: "code" | "arrival";
  value: string | null;
  /** ISO: quando il codice è stato sentito, non quando lo consegniamo. */
  collectedAt: string | null;
  gpsInside: boolean;
  confirmationTap: boolean;
  attendeeName: string | null;
}

export interface DeliveryPayload {
  deviceId: string;
  attendeeName?: string;
  codes: { value: string; collectedAt: string }[];
  /** Contesto, mai prova: informa la UX dell'Arrivo, non la provenienza. */
  gps?: { insideGeofence: boolean };
  confirmationTap?: boolean;
}

export interface PendingDelivery {
  eventId: string;
  payload: DeliveryPayload;
  /** Gli item consumati: si cancellano solo dopo l'accettazione del server. */
  itemIds: string[];
}

/**
 * Una consegna per evento. I codici portano il loro `collectedAt`: è ciò
 * che rende la prova autodatante — il codice del minuto N prova il minuto N
 * anche se la rete torna ore dopo.
 */
export function groupIntoDeliveries(
  items: WalletItem[],
  deviceId: string,
): PendingDelivery[] {
  const byEvent = new Map<string, PendingDelivery>();

  for (const item of items) {
    if (!item.eventId) continue;
    let delivery = byEvent.get(item.eventId);
    if (!delivery) {
      delivery = {
        eventId: item.eventId,
        payload: { deviceId, codes: [] },
        itemIds: [],
      };
      byEvent.set(item.eventId, delivery);
    }

    delivery.itemIds.push(item.id);

    if (item.kind === "code" && item.value && item.collectedAt) {
      delivery.payload.codes.push({
        value: item.value,
        collectedAt: item.collectedAt,
      });
    }
    if (item.gpsInside) delivery.payload.gps = { insideGeofence: true };
    if (item.confirmationTap) delivery.payload.confirmationTap = true;
    if (item.attendeeName) delivery.payload.attendeeName = item.attendeeName;
  }

  return [...byEvent.values()];
}

/**
 * Come reagire all'esito HTTP di una consegna.
 *
 * - `consumed`: il server ha deciso (2xx) o ha respinto in modo permanente
 *   (4xx) — in entrambi i casi gli item escono dal borsellino, altrimenti
 *   una consegna malformata bloccherebbe la coda per sempre.
 * - `retry`: errore transiente (offline, 5xx) — gli item restano e si
 *   ritenta. Questo È il borsellino che aspetta la rete: offline non è un
 *   caso d'errore.
 */
export function deliveryOutcome(status: number): "consumed" | "retry" {
  if (status >= 200 && status < 300) return "consumed";
  if (status >= 400 && status < 500) return "consumed";
  return "retry";
}
