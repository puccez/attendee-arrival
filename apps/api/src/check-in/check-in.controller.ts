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
import {
  deriveRotatingCode,
  evaluateDelivery,
  type CheckIn,
} from "@attendee-arrival/core";
import { CLOCK, type Clock } from "../clock.js";
import { EventsService } from "../events/events.service.js";

const deliverySchema = z.object({
  deviceId: z.string().min(1),
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
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Post("events")
  createEvent(@Body() body: unknown) {
    const parsed = createEventSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.events.create(parsed.data);
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
  deliver(@Param("eventId") eventId: string, @Body() body: unknown): CheckIn {
    const parsed = deliverySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    const event = this.events.get(eventId);
    return evaluateDelivery({
      event,
      ...parsed.data,
      deliveredAt: this.clock.now(),
    });
  }
}
