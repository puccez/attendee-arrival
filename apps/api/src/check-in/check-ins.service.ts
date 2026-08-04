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
  hostAttested?: boolean;
  confirmationTap?: boolean;
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

  async record(
    event: WeMeetEvent,
    input: DeliveryInput,
    deliveredAt: Date,
  ): Promise<AttendeeCheckIn> {
    const state: AttendeeState = (await this.store.load(
      event.id,
      input.deviceId,
    )) ?? {
      codes: [],
      sessions: [],
      hostAttested: false,
      confirmationTap: false,
      gpsInsideSeen: false,
    };
    // Le righe scritte prima delle sessioni non hanno il campo.
    state.sessions ??= [];

    // Prima raccolta vince: un codice già nel borsellino non viene
    // sostituito da una riconsegna con timestamp diverso.
    const byValue = new Map(state.codes.map((c) => [c.value, c]));
    for (const code of input.codes) {
      if (!byValue.has(code.value)) byValue.set(code.value, code);
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

    state.hostAttested ||= input.hostAttested === true;
    state.confirmationTap ||= input.confirmationTap === true;
    state.gpsInsideSeen ||= input.gps?.insideGeofence === true;
    state.attendeeName = input.attendeeName ?? state.attendeeName;

    const checkIn = evaluateDelivery({
      event,
      deviceId: input.deviceId,
      codes: state.codes,
      sessions: state.sessions,
      gps: state.gpsInsideSeen ? { insideGeofence: true } : undefined,
      hostAttested: state.hostAttested,
      confirmationTap: state.confirmationTap,
      deliveredAt,
    });

    const result: AttendeeCheckIn = {
      ...checkIn,
      attendeeName: state.attendeeName,
      updatedAt: deliveredAt,
    };
    await this.store.save(event.id, input.deviceId, state, result);
    return result;
  }

  list(eventId: string): Promise<AttendeeCheckIn[]> {
    return this.store.list(eventId);
  }
}
