import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
} from "@nestjs/common";
import { z } from "zod";
import { deriveRotatingCode } from "@attendee-arrival/core";
import { CLOCK, type Clock } from "../clock.js";
import { EventsService } from "../events/events.service.js";
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

  @Post("events")
  createEvent(@Body() body: unknown) {
    const parsed = createEventSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.events.create(parsed.data);
  }

  /** Dettagli pubblici dell'evento: il seme NON esce mai da qui. */
  @Get("events/:eventId")
  getEvent(@Param("eventId") eventId: string) {
    const { seed: _seed, ...publicEvent } = this.events.get(eventId);
    return publicEvent;
  }

  /** Il codice corrente per la console dell'evento (beacon-notaio). */
  @Get("events/:eventId/code")
  currentCode(@Param("eventId") eventId: string) {
    const event = this.events.get(eventId);
    return {
      code: deriveRotatingCode(event.seed, this.clock.now()),
      at: this.clock.now().toISOString(),
    };
  }

  @Post("events/:eventId/deliveries")
  deliver(
    @Param("eventId") eventId: string,
    @Body() body: unknown,
  ): AttendeeCheckIn {
    const parsed = deliverySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    const event = this.events.get(eventId);
    return this.checkIns.record(event, parsed.data, this.clock.now());
  }

  /** La dashboard dell'host: lo stato di tutti gli attendee dell'evento. */
  @Get("events/:eventId/check-ins")
  listCheckIns(@Param("eventId") eventId: string): AttendeeCheckIn[] {
    this.events.get(eventId); // 404 se sconosciuto
    return this.checkIns.list(eventId);
  }
}
