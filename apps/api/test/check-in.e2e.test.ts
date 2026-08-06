import "reflect-metadata";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deriveRotatingCode } from "@attendee-arrival/core";
import { AppModule } from "../src/app.module.js";
import { CLOCK } from "../src/clock.js";

// Black-box sulla cucitura HTTP (vedi docs/spec.md, Testing Decisions):
// dati in ingresso → check-in etichettato in uscita. Il tempo è controllato.

const NOW = new Date("2026-08-07T19:42:15Z");

describe("POST /events/:id/deliveries — la cucitura via HTTP", () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication["getHttpServer"]>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLOCK)
      .useValue({ now: () => NOW })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    http = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  async function createEvent() {
    const res = await request(http).post("/events").send({
      name: "WeMeet Milano",
      startsAt: "2026-08-07T19:00:00Z",
      endsAt: "2026-08-07T22:00:00Z",
    });
    expect(res.status).toBe(201);
    return res.body as { id: string; seed: string };
  }

  it("accredita 'machine' una consegna con codice valido", async () => {
    const event = await createEvent();
    const collectedAt = new Date("2026-08-07T19:42:10Z");
    const res = await request(http)
      .post(`/events/${event.id}/deliveries`)
      .send({
        deviceId: "device-anna",
        codes: [
          {
            value: deriveRotatingCode(event.seed, collectedAt),
            collectedAt: collectedAt.toISOString(),
          },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.accredited).toBe(true);
    expect(res.body.provenance).toBe("machine");
    expect(res.body.quality.validCodes).toBe(1);
  });

  it("solo GPS → 'none', mai accreditato", async () => {
    const event = await createEvent();
    const res = await request(http)
      .post(`/events/${event.id}/deliveries`)
      .send({
        deviceId: "device-divano",
        codes: [],
        gps: { insideGeofence: true },
      });

    expect(res.status).toBe(201);
    expect(res.body.accredited).toBe(false);
    expect(res.body.provenance).toBe("none");
  });

  it("evento sconosciuto → 404, corpo malformato → 400", async () => {
    const missing = await request(http)
      .post("/events/non-esiste/deliveries")
      .send({ deviceId: "x", codes: [] });
    expect(missing.status).toBe(404);

    const event = await createEvent();
    const malformed = await request(http)
      .post(`/events/${event.id}/deliveries`)
      .send({ codes: "non-una-lista" });
    expect(malformed.status).toBe(400);
  });

  it("le consegne dello stesso device si accumulano: il dwell cresce a ogni scansione", async () => {
    const event = await createEvent();
    const t1 = new Date("2026-08-07T19:10:00Z");
    const t2 = new Date("2026-08-07T19:16:00Z");
    const deliver = (t: Date) =>
      request(http)
        .post(`/events/${event.id}/deliveries`)
        .send({
          deviceId: "device-anna",
          attendeeName: "Anna",
          codes: [
            { value: deriveRotatingCode(event.seed, t), collectedAt: t.toISOString() },
          ],
        });

    await deliver(t1);
    const second = await deliver(t2);
    expect(second.body.quality.validCodes).toBe(2);
    expect(second.body.quality.coverageMinutes).toBe(6);

    const list = await request(http).get(`/events/${event.id}/check-ins`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].attendeeName).toBe("Anna");
    expect(list.body[0].quality.validCodes).toBe(2);
  });

  it("la telemetria si accetta ma non tocca il giudizio", async () => {
    // Un risveglio che non ha sentito niente: nessun codice da consegnare,
    // ma la riga di log parte lo stesso — è quella che spiega il silenzio.
    const event = await createEvent();
    const accepted = await request(http)
      .post(`/events/${event.id}/telemetry`)
      .send({
        deviceId: "device-anna",
        events: [
          { at: "2026-08-07T19:40:00Z", kind: "wake", detail: "geofence_ingresso" },
          { at: "2026-08-07T19:40:02Z", kind: "radio_drain", detail: "visti=0 nuovi=0" },
        ],
      });
    expect(accepted.status).toBe(201);
    expect(accepted.body.accepted).toBe(2);

    // Nessun check-in nato dalla telemetria: non è una consegna.
    const list = await request(http).get(`/events/${event.id}/check-ins`);
    expect(list.body).toHaveLength(0);

    const malformed = await request(http)
      .post(`/events/${event.id}/telemetry`)
      .send({ deviceId: "device-anna", events: [{ kind: "wake" }] });
    expect(malformed.status).toBe(400);
  });

  it("la testimonianza umana entra solo dalla porta dell'host", async () => {
    // Il borsellino dell'attendee non può dichiarare ciò che l'host ha visto:
    // il campo non esiste più nello schema della consegna e viene ignorato.
    const event = await createEvent();
    const selfServed = await request(http)
      .post(`/events/${event.id}/deliveries`)
      .send({ deviceId: "device-furbo", codes: [], hostAttested: true });

    expect(selfServed.status).toBe(201);
    expect(selfServed.body.provenance).toBe("none");
    expect(selfServed.body.accredited).toBe(false);

    // Dalla porta dell'host, invece, la stessa persona diventa 'human'.
    const attested = await request(http)
      .post(`/events/${event.id}/attestations`)
      .send({ deviceId: "device-furbo" });

    expect(attested.status).toBe(201);
    expect(attested.body.provenance).toBe("human");
    expect(attested.body.accredited).toBe(true);
  });

  it("l'host testimonia anche chi non ha mai consegnato niente", async () => {
    // Telefono scarico, permessi negati, nessuna app: la riga nasce qui.
    const event = await createEvent();
    const res = await request(http)
      .post(`/events/${event.id}/attestations`)
      .send({ deviceId: "senza-telefono-01", attendeeName: "Giulia" });

    expect(res.status).toBe(201);
    expect(res.body.provenance).toBe("human");

    const list = await request(http).get(`/events/${event.id}/check-ins`);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].attendeeName).toBe("Giulia");

    const malformed = await request(http)
      .post(`/events/${event.id}/attestations`)
      .send({ attendeeName: "senza device" });
    expect(malformed.status).toBe(400);
  });

  it("il ritardo di consegna misura l'età della prova, non la sua validità", async () => {
    // Stesso codice, stessa validità, due storie diverse: chi consegna in
    // diretta e chi consegna mezz'ora dopo averlo raccolto.
    const event = await createEvent();
    const live = new Date("2026-08-07T19:42:10Z");
    const stale = new Date("2026-08-07T19:12:10Z");

    const inDiretta = await request(http)
      .post(`/events/${event.id}/deliveries`)
      .send({
        deviceId: "device-presente",
        codes: [
          { value: deriveRotatingCode(event.seed, live), collectedAt: live.toISOString() },
        ],
      });
    expect(inDiretta.body.provenance).toBe("machine");
    expect(inDiretta.body.quality.deliveryLagMinutes).toBe(0);

    const inoltrata = await request(http)
      .post(`/events/${event.id}/deliveries`)
      .send({
        deviceId: "device-inoltrato",
        codes: [
          { value: deriveRotatingCode(event.seed, stale), collectedAt: stale.toISOString() },
        ],
      });
    expect(inoltrata.body.provenance).toBe("machine"); // accreditato lo stesso
    expect(inoltrata.body.quality.deliveryLagMinutes).toBe(30); // ma si vede

    // Il timbro è del server e non si riscrive: una riconsegna più tardi
    // non ringiovanisce la prova né la invecchia.
    const riconsegna = await request(http)
      .post(`/events/${event.id}/deliveries`)
      .send({
        deviceId: "device-inoltrato",
        codes: [
          { value: deriveRotatingCode(event.seed, stale), collectedAt: stale.toISOString() },
        ],
      });
    expect(riconsegna.body.quality.deliveryLagMinutes).toBe(30);
  });

  it("le sessioni si accumulano fra consegne: l'uscita chiude, il rientro riapre", async () => {
    // Prima consegna: sessione ancora aperta. Seconda: la stessa sessione
    // arriva chiusa, più una nuova dopo il rientro. I minuti fuori non contano.
    const event = await createEvent();
    const at = (iso: string) => new Date(iso);
    const code = (t: Date) => ({
      value: deriveRotatingCode(event.seed, t),
      collectedAt: t.toISOString(),
    });

    const first = await request(http)
      .post(`/events/${event.id}/deliveries`)
      .send({
        deviceId: "device-emanuele",
        codes: [code(at("2026-08-07T19:48:00Z")), code(at("2026-08-07T19:55:00Z"))],
        sessions: [{ startedAt: "2026-08-07T19:47:00Z" }],
      });
    expect(first.body.quality.coverageMinutes).toBe(7);

    const second = await request(http)
      .post(`/events/${event.id}/deliveries`)
      .send({
        deviceId: "device-emanuele",
        codes: [code(at("2026-08-07T20:12:00Z")), code(at("2026-08-07T20:14:00Z"))],
        sessions: [
          { startedAt: "2026-08-07T19:47:00Z", endedAt: "2026-08-07T19:56:00Z" },
          { startedAt: "2026-08-07T20:11:00Z" },
        ],
      });

    expect(second.body.quality.validCodes).toBe(4);
    expect(second.body.quality.coverageMinutes).toBe(9); // 7 + 2, non 26
    expect(second.body.quality.longestGapMinutes).toBe(17);
  });

  it("una riconsegna tardiva dello stesso codice non cancella la raccolta valida", async () => {
    const event = await createEvent();
    const collectedAt = new Date("2026-08-07T19:42:10Z");
    const code = deriveRotatingCode(event.seed, collectedAt);
    const deliver = (at: Date) =>
      request(http)
        .post(`/events/${event.id}/deliveries`)
        .send({
          deviceId: "device-anna",
          codes: [{ value: code, collectedAt: at.toISOString() }],
        });

    const first = await deliver(collectedAt);
    expect(first.body.provenance).toBe("machine");

    // Stesso codice ripresentato con un timestamp fuori finestra.
    const second = await deliver(new Date("2026-08-07T20:30:00Z"));
    expect(second.body.provenance).toBe("machine");
    expect(second.body.accredited).toBe(true);
  });

  it("emette un token PowerSync firmato col secret Supabase, sub = deviceId", async () => {
    process.env.SUPABASE_JWT_SECRET = "test-secret-abbastanza-lungo-123456";
    process.env.POWERSYNC_URL = "https://test.powersync.example";
    const res = await request(http)
      .post("/powersync-token")
      .send({ deviceId: "device-anna" });

    expect(res.status).toBe(201);
    expect(res.body.endpoint).toBe("https://test.powersync.example");
    const { default: jwt } = await import("jsonwebtoken");
    const payload = jwt.verify(
      res.body.token,
      "test-secret-abbastanza-lungo-123456",
      { audience: "authenticated" },
    ) as { sub: string };
    expect(payload.sub).toBe("device-anna");
  });

  it("espone il codice corrente alla console dell'evento", async () => {
    const event = await createEvent();
    const res = await request(http).get(`/events/${event.id}/code`);

    expect(res.status).toBe(200);
    expect(res.body.code).toBe(deriveRotatingCode(event.seed, NOW));
  });

  it("la porta del seme consegna il seme dell'evento al notaio", async () => {
    // Chi gioca il ruolo del notaio (telefono dell'host, ESP32 provisionato)
    // lo scarica una volta e poi deriva in locale, anche senza rete.
    const event = await createEvent();
    const res = await request(http).get(`/events/${event.id}/seed`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ seed: event.seed });
    expect(deriveRotatingCode(res.body.seed, NOW)).toBe(
      deriveRotatingCode(event.seed, NOW),
    );

    const missing = await request(http).get("/events/non-esiste/seed");
    expect(missing.status).toBe(404);
  });

  it("il seme non trapela da nessun'altra porta", async () => {
    // L'attendee riceve il seme via radio, mai via API: le risposte che un
    // borsellino può vedere non devono contenerlo — né come campo, né
    // annegato da qualche parte nel corpo.
    const event = await createEvent();
    const collectedAt = new Date("2026-08-07T19:42:10Z");

    const dettagli = await request(http).get(`/events/${event.id}`);
    expect(dettagli.status).toBe(200);
    expect(dettagli.body.seed).toBeUndefined();
    expect(JSON.stringify(dettagli.body)).not.toContain(event.seed);

    const consegna = await request(http)
      .post(`/events/${event.id}/deliveries`)
      .send({
        deviceId: "device-anna",
        codes: [
          {
            value: deriveRotatingCode(event.seed, collectedAt),
            collectedAt: collectedAt.toISOString(),
          },
        ],
      });
    expect(consegna.status).toBe(201);
    expect(JSON.stringify(consegna.body)).not.toContain(event.seed);

    const lista = await request(http).get(`/events/${event.id}/check-ins`);
    expect(JSON.stringify(lista.body)).not.toContain(event.seed);

    const codice = await request(http).get(`/events/${event.id}/code`);
    expect(JSON.stringify(codice.body)).not.toContain(event.seed);
  });
});
