import assert from "node:assert/strict";
import test from "node:test";

import {
  deliveryOutcome,
  groupIntoDeliveries,
  type WalletItem,
} from "../src/lib/delivery.ts";

function code(
  id: string,
  eventId: string,
  value: string,
  collectedAt: string,
): WalletItem {
  return {
    id,
    eventId,
    kind: "code",
    value,
    collectedAt,
    gpsInside: false,
    confirmationTap: false,
    attendeeName: null,
  };
}

test("una consegna per evento, con tutti i codici raccolti", () => {
  const deliveries = groupIntoDeliveries(
    [
      code("1", "evento-a", "111111", "2026-08-04T20:00:00.000Z"),
      code("2", "evento-a", "222222", "2026-08-04T20:30:00.000Z"),
      code("3", "evento-b", "333333", "2026-08-04T21:00:00.000Z"),
    ],
    "device-1",
  );

  assert.equal(deliveries.length, 2, "eventi distinti, consegne distinte");
  const a = deliveries.find((d) => d.eventId === "evento-a")!;
  assert.deepEqual(a.payload.codes.map((c) => c.value), ["111111", "222222"]);
  assert.deepEqual(a.itemIds, ["1", "2"]);
  assert.equal(a.payload.deviceId, "device-1");
});

test("i codici portano il momento della raccolta, non della consegna", () => {
  const collectedAt = "2026-08-04T20:00:00.000Z";
  const [delivery] = groupIntoDeliveries(
    [code("1", "evento-a", "111111", collectedAt)],
    "device-1",
  );
  assert.equal(delivery.payload.codes[0].collectedAt, collectedAt);
});

test("il contesto dell'Arrivo si somma ai codici, non li sostituisce", () => {
  const [delivery] = groupIntoDeliveries(
    [
      code("1", "evento-a", "111111", "2026-08-04T20:00:00.000Z"),
      {
        id: "2",
        eventId: "evento-a",
        kind: "arrival",
        value: null,
        collectedAt: null,
        gpsInside: true,
        confirmationTap: true,
        attendeeName: "Giulia",
      },
    ],
    "device-1",
  );

  assert.equal(delivery.payload.codes.length, 1);
  assert.deepEqual(delivery.payload.gps, { insideGeofence: true });
  assert.equal(delivery.payload.confirmationTap, true);
  assert.equal(delivery.payload.attendeeName, "Giulia");
  assert.deepEqual(delivery.itemIds, ["1", "2"], "anche il contesto si consuma");
});

test("il solo contesto GPS produce comunque una consegna senza codici", () => {
  // Il server la etichetterà provenienza 'nessuno': il GPS non è mai prova.
  const [delivery] = groupIntoDeliveries(
    [
      {
        id: "1",
        eventId: "evento-a",
        kind: "arrival",
        value: null,
        collectedAt: null,
        gpsInside: true,
        confirmationTap: false,
        attendeeName: null,
      },
    ],
    "device-1",
  );
  assert.deepEqual(delivery.payload.codes, []);
  assert.deepEqual(delivery.payload.gps, { insideGeofence: true });
});

test("offline e 5xx si ritentano, il resto si consuma", () => {
  assert.equal(deliveryOutcome(0), "retry", "nessuna rete");
  assert.equal(deliveryOutcome(500), "retry");
  assert.equal(deliveryOutcome(503), "retry");
  assert.equal(deliveryOutcome(201), "consumed");
  assert.equal(deliveryOutcome(200), "consumed");
  assert.equal(
    deliveryOutcome(400),
    "consumed",
    "una consegna malformata non deve bloccare la coda per sempre",
  );
  assert.equal(deliveryOutcome(404), "consumed", "evento sconosciuto");
});
