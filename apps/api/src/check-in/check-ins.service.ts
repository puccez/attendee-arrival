import { Inject, Injectable } from "@nestjs/common";
import {
  evaluateDelivery,
  type CheckIn,
  type CollectedCode,
  type PresenceSession,
} from "@attendee-arrival/core";
import type { WeMeetEvent } from "../events/events.service.js";
import {
  CHECK_INS_STORE,
  type AttendeeState,
  type CheckInsStore,
} from "../store/store.js";

export interface DeliveryInput {
  deviceId: string;
  attendeeName?: string;
  codes: CollectedCode[];
  sessions?: PresenceSession[];
  gps?: { insideGeofence: boolean };
  confirmationTap?: boolean;
}

/**
 * La testimonianza umana: l'host ha verificato la persona davanti a sé.
 *
 * Non è un campo della consegna, ed è una distinzione di modello, non di
 * comodità: la consegna è ciò che l'attendee afferma di aver raccolto, la
 * testimonianza è ciò che l'host afferma di aver visto. Farle entrare dalla
 * stessa porta significherebbe lasciare che il borsellino di qualcuno si
 * accrediti da solo la parola di qualcun altro.
 *
 * Se il device non ha mai consegnato niente la riga nasce qui: è il caso del
 * telefono scarico, o di chi l'app non ce l'ha proprio.
 */
export interface AttestationInput {
  deviceId: string;
  attendeeName?: string;
}

export interface AttendeeCheckIn extends CheckIn {
  attendeeName?: string;
  updatedAt: Date;
}

/**
 * Accumula le consegne per (evento, device) e ri-valuta l'unione col core:
 * il borsellino consegna a rate e il dwell cresce a ogni scansione.
 */
@Injectable()
export class CheckInsService {
  constructor(
    @Inject(CHECK_INS_STORE) private readonly store: CheckInsStore,
  ) {}

  private async loadState(
    eventId: string,
    deviceId: string,
  ): Promise<AttendeeState> {
    const state: AttendeeState = (await this.store.load(eventId, deviceId)) ?? {
      codes: [],
      sessions: [],
      hostAttested: false,
      confirmationTap: false,
      gpsInsideSeen: false,
    };
    // Le righe scritte prima delle sessioni non hanno il campo.
    state.sessions ??= [];
    return state;
  }

  private async evaluateAndSave(
    event: WeMeetEvent,
    deviceId: string,
    state: AttendeeState,
    at: Date,
  ): Promise<AttendeeCheckIn> {
    const checkIn = evaluateDelivery({
      event,
      deviceId,
      codes: state.codes,
      sessions: state.sessions,
      gps: state.gpsInsideSeen ? { insideGeofence: true } : undefined,
      hostAttested: state.hostAttested,
      confirmationTap: state.confirmationTap,
      deliveredAt: at,
    });

    const result: AttendeeCheckIn = {
      ...checkIn,
      attendeeName: state.attendeeName,
      updatedAt: at,
    };
    await this.store.save(event.id, deviceId, state, result);
    return result;
  }

  /** L'host testimonia una persona: vedi AttestationInput. */
  async attest(
    event: WeMeetEvent,
    input: AttestationInput,
    at: Date,
  ): Promise<AttendeeCheckIn> {
    const state = await this.loadState(event.id, input.deviceId);
    state.hostAttested = true;
    state.attendeeName = input.attendeeName ?? state.attendeeName;
    return this.evaluateAndSave(event, input.deviceId, state, at);
  }

  async record(
    event: WeMeetEvent,
    input: DeliveryInput,
    deliveredAt: Date,
  ): Promise<AttendeeCheckIn> {
    const state = await this.loadState(event.id, input.deviceId);

    // Prima raccolta vince: un codice già nel borsellino non viene
    // sostituito da una riconsegna con timestamp diverso. L'istante d'arrivo
    // lo mette il server, e solo la prima volta: è l'unico dato della
    // consegna che non arriva dal client, ed è quello che rende misurabile
    // il ritardo di una prova inoltrata (vedi Quality.deliveryLagMinutes).
    const byValue = new Map(state.codes.map((c) => [c.value, c]));
    for (const code of input.codes) {
      if (!byValue.has(code.value)) {
        byValue.set(code.value, { ...code, deliveredAt });
      }
    }
    state.codes = [...byValue.values()];

    // Le sessioni si identificano dall'istante d'apertura: la stessa sessione
    // arriva prima aperta e poi chiusa, e la chiusura va conservata. Non si
    // riapre mai una sessione già chiusa — uscire è definitivo, si rientra
    // con una sessione nuova.
    const byStart = new Map(
      state.sessions.map((s) => [s.startedAt.getTime(), s]),
    );
    for (const session of input.sessions ?? []) {
      const key = session.startedAt.getTime();
      const known = byStart.get(key);
      if (!known) byStart.set(key, session);
      else if (session.endedAt && !known.endedAt) known.endedAt = session.endedAt;
    }
    state.sessions = [...byStart.values()].sort(
      (a, b) => a.startedAt.getTime() - b.startedAt.getTime(),
    );

    state.confirmationTap ||= input.confirmationTap === true;
    state.gpsInsideSeen ||= input.gps?.insideGeofence === true;
    state.attendeeName = input.attendeeName ?? state.attendeeName;

    return this.evaluateAndSave(event, input.deviceId, state, deliveredAt);
  }

  list(eventId: string): Promise<AttendeeCheckIn[]> {
    return this.store.list(eventId);
  }
}
