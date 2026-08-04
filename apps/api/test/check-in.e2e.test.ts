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
    const t2 = new Date("2026-08-07T19:38:00Z");
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
    expect(second.body.quality.coverageMinutes).toBe(28);

    const list = await request(http).get(`/events/${event.id}/check-ins`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].attendeeName).toBe("Anna");
    expect(list.body[0].quality.validCodes).toBe(2);
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
});
