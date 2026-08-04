import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  ServiceUnavailableException,
} from "@nestjs/common";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { deriveRotatingCode } from "@attendee-arrival/core";
import { CLOCK, type Clock } from "../clock.js";
import { EventsService } from "../events/events.service.js";
import { resolveBacking } from "../store/lazy.js";
import { CheckInsService, type AttendeeCheckIn } from "./check-ins.service.js";

const deliverySchema = z.object({
  deviceId: z.string().min(1),
  attendeeName: z.string().min(1).optional(),
  codes: z.array(
    z.object({
      value: z.string().min(1),
      collectedAt: z.coerce.date(),
    }),
  ),
  gps: z.object({ insideGeofence: z.boolean() }).optional(),
  hostAttested: z.boolean().optional(),
  confirmationTap: z.boolean().optional(),
});

const createEventSchema = z.object({
  name: z.string().min(1),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  geofence: z
    .object({ lat: z.number(), lng: z.number(), radiusM: z.number().positive() })
    .optional(),
});

/**
 * La cucitura di verifica esposta via HTTP (vedi docs/spec.md).
 * Modulo sottile: tutta la logica di fiducia vive in @attendee-arrival/core.
 */
@Controller()
export class CheckInController {
  constructor(
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(CheckInsService) private readonly checkIns: CheckInsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Stato del servizio: quale store è attivo (nessun segreto esposto). */
  @Get("health")
  health() {
    return { store: resolveBacking().kind };
  }

  @Post("events")
  createEvent(@Body() body: unknown) {
    const parsed = createEventSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.events.create(parsed.data);
  }

  /** Dettagli pubblici dell'evento: il seme NON esce mai da qui. */
  @Get("events/:eventId")
  async getEvent(@Param("eventId") eventId: string) {
    const { seed: _seed, ...publicEvent } = await this.events.get(eventId);
    return publicEvent;
  }

  /** Il codice corrente per la console dell'evento (beacon-notaio). */
  @Get("events/:eventId/code")
  async currentCode(@Param("eventId") eventId: string) {
    const event = await this.events.get(eventId);
    return {
      code: deriveRotatingCode(event.seed, this.clock.now()),
      at: this.clock.now().toISOString(),
    };
  }

  /**
   * Token per il sync PowerSync del borsellino: firmato HS256 col JWT
   * secret Supabase, sub = deviceId. Il secret non lascia mai il server.
   */
  @Post("powersync-token")
  powersyncToken(@Body() body: unknown) {
    const parsed = z.object({ deviceId: z.string().min(1) }).safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    const secret = process.env.SUPABASE_JWT_SECRET;
    const endpoint = process.env.POWERSYNC_URL;
    if (!secret || !endpoint) {
      throw new ServiceUnavailableException("PowerSync non configurato");
    }
    const token = jwt.sign(
      { role: "authenticated" },
      secret,
      {
        algorithm: "HS256",
        subject: parsed.data.deviceId,
        audience: "authenticated",
        expiresIn: "12h",
      },
    );
    return { token, endpoint };
  }

  @Post("events/:eventId/deliveries")
  async deliver(
    @Param("eventId") eventId: string,
    @Body() body: unknown,
  ): Promise<AttendeeCheckIn> {
    const parsed = deliverySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    const event = await this.events.get(eventId);
    return this.checkIns.record(event, parsed.data, this.clock.now());
  }

  /** La dashboard dell'host: lo stato di tutti gli attendee dell'evento. */
  @Get("events/:eventId/check-ins")
  async listCheckIns(
    @Param("eventId") eventId: string,
  ): Promise<AttendeeCheckIn[]> {
    await this.events.get(eventId); // 404 se sconosciuto
    return this.checkIns.list(eventId);
  }
}
