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

  it("espone il codice corrente alla console dell'evento", async () => {
    const event = await createEvent();
    const res = await request(http).get(`/events/${event.id}/code`);

    expect(res.status).toBe(200);
    expect(res.body.code).toBe(deriveRotatingCode(event.seed, NOW));
  });
});
