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

  it("qualità: la copertura accredita il campionato, non l'arco", () => {
    // Quattro risvegli in background su un'ora e venti. L'arco direbbe 78
    // minuti, ma fra un codice e l'altro passano mezz'ore che nessuno ha
    // sentito: si accredita fino al tetto (10 min), e il resto lo racconta
    // il buco massimo. Numero più piccolo, e vero.
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
    expect(checkIn.quality.coverageMinutes).toBe(30); // 10 + 10 + 10, non 78
    expect(checkIn.quality.longestGapMinutes).toBe(31);
  });

  it("qualità: chi resta davvero accumula copertura densa", () => {
    // Telefono in mano vicino al beacon: un codice ogni due minuti. Nessun
    // intervallo tocca il tetto, quindi la copertura è la permanenza vera.
    const at = (iso: string) => new Date(iso);
    const times = Array.from(
      { length: 10 },
      (_, i) => new Date(Date.parse("2026-08-07T19:42:00Z") + i * 120_000),
    );
    const checkIn = evaluateDelivery({
      event,
      deviceId: "device-anna",
      codes: times.map((t) => ({
        value: deriveRotatingCode(SEED, t),
        collectedAt: t,
      })),
      deliveredAt: at("2026-08-07T20:01:00Z"),
    });

    expect(checkIn.quality.coverageMinutes).toBe(18); // 9 intervalli da 2 min
    expect(checkIn.quality.longestGapMinutes).toBe(2);
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

  it("esce e rientra: i minuti fuori non entrano nella copertura", () => {
    // Il caso osservato dal vivo: 7 minuti al venue, 17 fuori, poi rientro.
    // L'arco fra primo e ultimo codice direbbe 26 — ma 17 li ha passati a
    // 400 metri, e l'uscita dalla region lo dice. Un client onesto ottiene
    // 9; uno che tacesse ne otterrebbe 19 (test successivo), mai 26.
    const at = (iso: string) => new Date(iso);
    const times = [
      at("2026-08-07T19:48:00Z"),
      at("2026-08-07T19:51:00Z"),
      at("2026-08-07T19:55:00Z"),
      at("2026-08-07T20:12:00Z"),
      at("2026-08-07T20:14:00Z"),
    ];
    const checkIn = evaluateDelivery({
      event,
      deviceId: "device-emanuele",
      codes: times.map((t) => ({
        value: deriveRotatingCode(SEED, t),
        collectedAt: t,
      })),
      sessions: [
        { startedAt: at("2026-08-07T19:47:00Z"), endedAt: at("2026-08-07T19:56:00Z") },
        { startedAt: at("2026-08-07T20:11:00Z") }, // ancora aperta
      ],
      deliveredAt: at("2026-08-07T20:14:05Z"),
    });

    expect(checkIn.quality.validCodes).toBe(5);
    expect(checkIn.quality.coverageMinutes).toBe(9); // 7 + 2, non 26
    expect(checkIn.quality.longestGapMinutes).toBe(17); // il buco è visibile
  });

  it("una sessione aperta tardi non cancella le ore prima", () => {
    // Caso vero, serata del 4 agosto: l'app viene riavviata a metà evento e
    // apre la sua prima sessione alle 22:20. I codici delle due ore
    // precedenti erano già stati raccolti e verificati — non sono sospetti,
    // sono solo anteriori a quando il telefono ha saputo di essere in region.
    // Solo un'uscita *dichiarata* taglia; l'ignoranza non taglia niente.
    const at = (iso: string) => new Date(iso);
    const times = [
      at("2026-08-07T19:48:00Z"),
      at("2026-08-07T19:53:00Z"),
      at("2026-08-07T22:20:30Z"),
      at("2026-08-07T22:22:30Z"),
    ];
    const checkIn = evaluateDelivery({
      event: { ...event, endsAt: at("2026-08-08T01:00:00Z") },
      deviceId: "device-riavviato",
      codes: times.map((t) => ({
        value: deriveRotatingCode(SEED, t),
        collectedAt: t,
      })),
      sessions: [{ startedAt: at("2026-08-07T22:20:11Z") }], // aperta, tardi
      deliveredAt: at("2026-08-07T22:23:00Z"),
    });

    expect(checkIn.quality.coverageMinutes).toBe(17); // 5 + 10 (tetto) + 2
  });

  it("una sessione dichiarata lunga non allunga la copertura: contano i codici", () => {
    // Il client non è fidato. Dichiara tre ore di presenza con un codice solo:
    // la sessione delimita, i codici misurano.
    const collectedAt = new Date("2026-08-07T19:42:10Z");
    const checkIn = evaluateDelivery({
      event,
      deviceId: "device-bugiardo",
      codes: [{ value: deriveRotatingCode(SEED, collectedAt), collectedAt }],
      sessions: [
        {
          startedAt: new Date("2026-08-07T19:00:00Z"),
          endedAt: new Date("2026-08-07T22:00:00Z"),
        },
      ],
      deliveredAt: new Date("2026-08-07T22:00:05Z"),
    });

    expect(checkIn.accredited).toBe(true);
    expect(checkIn.quality.coverageMinutes).toBe(0);
  });

  it("senza sessioni il tetto regge lo stesso: il silenzio non compra minuti", () => {
    // Il client web non ha region BLE e non ha sessioni da consegnare. Ma il
    // caso interessante è l'altro: un client che *sceglie* di tacere per
    // farsi accreditare l'assenza. Il tetto vale comunque — 24 minuti di
    // buco valgono 10, non 24 — e il buco resta scritto in chiaro.
    const at = (iso: string) => new Date(iso);
    const times = [at("2026-08-07T19:48:00Z"), at("2026-08-07T20:12:00Z")];
    const checkIn = evaluateDelivery({
      event,
      deviceId: "device-web",
      codes: times.map((t) => ({
        value: deriveRotatingCode(SEED, t),
        collectedAt: t,
      })),
      deliveredAt: at("2026-08-07T20:12:05Z"),
    });

    expect(checkIn.quality.coverageMinutes).toBe(10);
    expect(checkIn.quality.longestGapMinutes).toBe(24);
  });

  it("omettere l'uscita non riporta la copertura all'arco", () => {
    // Stessi codici di 'esce e rientra', ma il telefono non dichiara niente.
    // Prima questo bastava a farsi accreditare l'arco intero (26 min):
    // ora l'unico intervallo che conteneva l'assenza viene tappato a 10.
    const at = (iso: string) => new Date(iso);
    const times = [
      at("2026-08-07T19:48:00Z"),
      at("2026-08-07T19:51:00Z"),
      at("2026-08-07T19:55:00Z"),
      at("2026-08-07T20:12:00Z"),
      at("2026-08-07T20:14:00Z"),
    ];
    const checkIn = evaluateDelivery({
      event,
      deviceId: "device-reticente",
      codes: times.map((t) => ({
        value: deriveRotatingCode(SEED, t),
        collectedAt: t,
      })),
      deliveredAt: at("2026-08-07T20:14:05Z"),
    });

    expect(checkIn.quality.coverageMinutes).toBe(19); // 3 + 4 + 10 + 2
    expect(checkIn.quality.longestGapMinutes).toBe(17);
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
