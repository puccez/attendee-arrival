import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
  sessions: z
    .array(
      z.object({
        startedAt: z.coerce.date(),
        endedAt: z.coerce.date().optional(),
      }),
    )
    .optional(),
  gps: z.object({ insideGeofence: z.boolean() }).optional(),
  confirmationTap: z.boolean().optional(),
});

/**
 * La testimonianza umana entra da una porta sua. Il borsellino dell'attendee
 * non può dichiararla — vedi AttestationInput in check-ins.service.ts.
 */
const attestationSchema = z.object({
  deviceId: z.string().min(1),
  attendeeName: z.string().min(1).optional(),
});

const telemetrySchema = z.object({
  deviceId: z.string().min(1),
  events: z
    .array(
      z.object({
        at: z.coerce.date(),
        kind: z.string().min(1).max(40),
        detail: z.string().max(400).optional(),
      }),
    )
    .max(500),
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

  /**
   * Gli eventi recenti, per la scelta a tocco nell'app: al posto dell'id
   * incollato a mano. Come per i dettagli, il seme NON esce da qui.
   */
  @Get("events")
  async listEvents() {
    const events = await this.events.list();
    return events.map(({ seed: _seed, ...publicEvent }) => publicEvent);
  }

  /**
   * La porta distruttiva: con l'evento se ne vanno consegne e telemetria —
   * righe che senza il loro evento non racconterebbero più niente. Nel
   * livello demo la credenziale è, come per il seme, il possesso dell'id
   * (docs/business-case.md §9.2); in produzione questa porta è dell'host,
   * ed è la prima a cui agganciare l'autenticazione.
   */
  @Delete("events/:eventId")
  @HttpCode(204)
  async deleteEvent(@Param("eventId") eventId: string): Promise<void> {
    await this.events.delete(eventId);
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
   * La porta del seme: chi gioca il ruolo del notaio lo scarica una volta e
   * poi deriva in locale — la rete del locale può morire, l'emissione no.
   *
   * È la porta dell'host, come la testimonianza: tre porte, tre livelli di
   * fiducia (consegna / testimonianza / seme). Nel livello demo la
   * credenziale è il possesso dell'id evento, come per la console — limite
   * dichiarato (docs/business-case.md §9.2); in produzione è qui che si
   * aggancia l'host token. Il seme non passa MAI dalle porte dell'attendee:
   * chi deve solo riceverlo via radio non deve poterlo vedere.
   */
  @Get("events/:eventId/seed")
  async eventSeed(@Param("eventId") eventId: string) {
    const event = await this.events.get(eventId);
    return { seed: event.seed };
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

  /**
   * L'host testimonia una persona: provenienza `human`.
   *
   * È un'azione dell'host su un attendee, non un campo di una consegna: da
   * qui nasce anche la riga di chi non ha mai consegnato niente — telefono
   * scarico, permessi negati, nessuna app.
   *
   * Nella demo la porta è aperta come tutte le altre (vedi docs/business-case.md
   * §9.2): in produzione è qui che si aggancia l'autenticazione dell'host, ed
   * è una guard sola perché la testimonianza ha un endpoint suo.
   */
  @Post("events/:eventId/attestations")
  async attest(
    @Param("eventId") eventId: string,
    @Body() body: unknown,
  ): Promise<AttendeeCheckIn> {
    const parsed = attestationSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    const event = await this.events.get(eventId);
    return this.checkIns.attest(event, parsed.data, this.clock.now());
  }

  /**
   * Telemetria del device: cosa ha fatto il telefono, non cosa ha provato.
   *
   * Endpoint separato dalle consegne di proposito, per due ragioni. La prima
   * è di fiducia: la telemetria non entra nella cucitura di verifica e non
   * deve nemmeno passarci accanto. La seconda è pratica: i momenti da
   * raccontare più interessanti sono quelli in cui *non* c'è niente da
   * consegnare — un risveglio che non ha sentito nessun codice è la riga di
   * log che spiega un silenzio.
   */
  @Post("events/:eventId/telemetry")
  async telemetry(
    @Param("eventId") eventId: string,
    @Body() body: unknown,
  ): Promise<{ accepted: number }> {
    const parsed = telemetrySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    await this.events.get(eventId); // 404 se sconosciuto
    await resolveBacking().telemetry.append(
      eventId,
      parsed.data.deviceId,
      parsed.data.events,
    );
    return { accepted: parsed.data.events.length };
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
