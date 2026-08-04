import { describe, expect, it } from "vitest";
import { deriveRotatingCode, evaluateDelivery } from "../src/index.js";

// Vocabolario da CONTEXT.md: Codice Rotante, provenienza × qualità, dwell opportunistico.
// La derivazione dei codici è la stessa funzione del beacon-notaio, usata qui come fixture.

const SEED = "seme-evento-demo";

const event = {
  id: "wemeet-mi-01",
  seed: SEED,
  startsAt: new Date("2026-08-07T19:00:00Z"),
  endsAt: new Date("2026-08-07T22:00:00Z"),
};

describe("cucitura di verifica: consegna di codici → check-in etichettato", () => {
  it("accredita con provenienza 'machine' un codice valido nella sua finestra", () => {
    const collectedAt = new Date("2026-08-07T19:42:10Z");
    const checkIn = evaluateDelivery({
      event,
      deviceId: "device-anna",
      codes: [{ value: deriveRotatingCode(SEED, collectedAt), collectedAt }],
      deliveredAt: new Date("2026-08-07T19:42:15Z"),
    });

    expect(checkIn.accredited).toBe(true);
    expect(checkIn.provenance).toBe("machine");
  });

  it("respinge un codice presentato per una finestra diversa da quella in cui è nato", () => {
    // Codice nato alle 19:42, spacciato per raccolto alle 20:30: replay.
    const bornAt = new Date("2026-08-07T19:42:10Z");
    const claimedAt = new Date("2026-08-07T20:30:00Z");
    const checkIn = evaluateDelivery({
      event,
      deviceId: "device-marco",
      codes: [{ value: deriveRotatingCode(SEED, bornAt), collectedAt: claimedAt }],
      deliveredAt: new Date("2026-08-07T20:30:05Z"),
    });

    expect(checkIn.accredited).toBe(false);
    expect(checkIn.provenance).toBe("none");
  });

  it("tollera lo skew d'orologio: codice della finestra adiacente accettato", () => {
    // Il beacon ha derivato il codice un attimo prima del cambio finestra;
    // il telefono lo registra con l'orologio già nella finestra successiva.
    const bornAt = new Date("2026-08-07T19:42:29Z");
    const claimedAt = new Date("2026-08-07T19:42:31Z"); // finestra successiva
    const checkIn = evaluateDelivery({
      event,
      deviceId: "device-anna",
      codes: [{ value: deriveRotatingCode(SEED, bornAt), collectedAt: claimedAt }],
      deliveredAt: new Date("2026-08-07T19:42:35Z"),
    });

    expect(checkIn.accredited).toBe(true);
    expect(checkIn.provenance).toBe("machine");
  });

  it("back-to-back: i codici dell'evento precedente non accreditano sull'evento registrato", () => {
    // Stesso venue, evento B dopo evento A: chi indugia dopo A sente ancora
    // i codici di A, ma è registrato a B — la consegna si valuta contro B.
    const eventB = {
      id: "wemeet-mi-02",
      seed: "seme-evento-b",
      startsAt: new Date("2026-08-07T22:00:00Z"),
      endsAt: new Date("2026-08-08T00:00:00Z"),
    };
    const collectedAt = new Date("2026-08-07T22:05:00Z");
    const checkIn = evaluateDelivery({
      event: eventB,
      deviceId: "device-luca",
      codes: [{ value: deriveRotatingCode(SEED, collectedAt), collectedAt }], // seme di A
      deliveredAt: new Date("2026-08-07T22:05:10Z"),
    });

    expect(checkIn.accredited).toBe(false);
    expect(checkIn.provenance).toBe("none");
  });

  it("offline: consegna in ritardo entro la finestra, accreditata per i minuti dei codici", () => {
    // Modalità aereo: codici raccolti alle 19:42, consegnati alle 22:15.
    const collectedAt = new Date("2026-08-07T19:42:10Z");
    const checkIn = evaluateDelivery({
      event,
      deviceId: "device-anna",
      codes: [{ value: deriveRotatingCode(SEED, collectedAt), collectedAt }],
      deliveredAt: new Date("2026-08-07T22:15:00Z"),
    });

    expect(checkIn.accredited).toBe(true);
    expect(checkIn.provenance).toBe("machine");
  });

  it("respinge in blocco una consegna oltre la finestra di ritardo dichiarata", () => {
    // Il margine di replay è contenuto: default 6 ore dalla raccolta.
    const collectedAt = new Date("2026-08-07T19:42:10Z");
    const checkIn = evaluateDelivery({
      event,
      deviceId: "device-marco",
      codes: [{ value: deriveRotatingCode(SEED, collectedAt), collectedAt }],
      deliveredAt: new Date("2026-08-08T09:00:00Z"), // ~13 ore dopo
    });

    expect(checkIn.accredited).toBe(false);
    expect(checkIn.provenance).toBe("none");
  });

  it("qualità: codici distribuiti sulla serata misurano il dwell", () => {
    const at = (iso: string) => new Date(iso);
    const times = [
      at("2026-08-07T19:42:00Z"),
      at("2026-08-07T20:10:00Z"),
      at("2026-08-07T20:41:00Z"),
      at("2026-08-07T21:00:00Z"),
    ];
    const checkIn = evaluateDelivery({
      event,
      deviceId: "device-anna",
      codes: times.map((t) => ({
        value: deriveRotatingCode(SEED, t),
        collectedAt: t,
      })),
      deliveredAt: at("2026-08-07T21:00:05Z"),
    });

    expect(checkIn.quality.validCodes).toBe(4);
    expect(checkIn.quality.coverageMinutes).toBe(78); // 19:42 → 21:00
  });

  it("qualità: il check-in-e-fuga si vede — un solo codice, copertura zero", () => {
    const collectedAt = new Date("2026-08-07T19:42:10Z");
    const checkIn = evaluateDelivery({
      event,
      deviceId: "device-furbo",
      codes: [{ value: deriveRotatingCode(SEED, collectedAt), collectedAt }],
      deliveredAt: new Date("2026-08-07T19:43:00Z"),
    });

    expect(checkIn.accredited).toBe(true); // presente sì...
    expect(checkIn.quality.validCodes).toBe(1); // ...ma quanto, si vede
    expect(checkIn.quality.coverageMinutes).toBe(0);
  });

  it("qualità: lo stesso codice consegnato due volte conta una volta sola", () => {
    const collectedAt = new Date("2026-08-07T19:42:10Z");
    const code = { value: deriveRotatingCode(SEED, collectedAt), collectedAt };
    const checkIn = evaluateDelivery({
      event,
      deviceId: "device-furbo",
      codes: [code, { ...code }],
      deliveredAt: new Date("2026-08-07T19:43:00Z"),
    });

    expect(checkIn.quality.validCodes).toBe(1);
  });

  it("il GPS da solo non accredita mai: provenienza 'none' anche dentro il geofence", () => {
    // Spoofing GPS irrilevante per costruzione: senza codici non esisti.
    const checkIn = evaluateDelivery({
      event,
      deviceId: "device-divano",
      codes: [],
      gps: { insideGeofence: true },
      deliveredAt: new Date("2026-08-07T19:45:00Z"),
    });

    expect(checkIn.accredited).toBe(false);
    expect(checkIn.provenance).toBe("none");
  });

  it("testimone umano: la spunta dell'host accredita con provenienza 'human'", () => {
    // Telefono morto, permessi negati: l'host verifica la persona di fronte a sé.
    const checkIn = evaluateDelivery({
      event,
      deviceId: "device-sfortunata",
      codes: [],
      hostAttested: true,
      deliveredAt: new Date("2026-08-07T19:50:00Z"),
    });

    expect(checkIn.accredited).toBe(true);
    expect(checkIn.provenance).toBe("human");
  });

  it("caso più forte: codici validi + spunta host → 'machine+human'", () => {
    // 'machine' prova il device, 'human' la persona: insieme, non in scala.
    const collectedAt = new Date("2026-08-07T19:42:10Z");
    const checkIn = evaluateDelivery({
      event,
      deviceId: "device-anna",
      codes: [{ value: deriveRotatingCode(SEED, collectedAt), collectedAt }],
      hostAttested: true,
      deliveredAt: new Date("2026-08-07T19:42:15Z"),
    });

    expect(checkIn.accredited).toBe(true);
    expect(checkIn.provenance).toBe("machine+human");
  });

  it("il tap sulla notifica contribuisce alla qualità, mai alla provenienza", () => {
    // L'amico che tappa 'confermo' dal divano non produce nulla:
    // il tap arricchisce un check-in, non lo crea.
    const tapOnly = evaluateDelivery({
      event,
      deviceId: "device-divano",
      codes: [],
      confirmationTap: true,
      deliveredAt: new Date("2026-08-07T19:45:00Z"),
    });
    expect(tapOnly.accredited).toBe(false);
    expect(tapOnly.provenance).toBe("none");
    expect(tapOnly.quality.tappedNotification).toBe(true);

    const collectedAt = new Date("2026-08-07T19:42:10Z");
    const withCodes = evaluateDelivery({
      event,
      deviceId: "device-anna",
      codes: [{ value: deriveRotatingCode(SEED, collectedAt), collectedAt }],
      confirmationTap: true,
      deliveredAt: new Date("2026-08-07T19:42:15Z"),
    });
    expect(withCodes.provenance).toBe("machine");
    expect(withCodes.quality.tappedNotification).toBe(true);
  });
});
