import type { CollectedCode, PresenceSession } from "@attendee-arrival/core";
import type { AttendeeCheckIn } from "../check-in/check-ins.service.js";
import type { WeMeetEvent } from "../events/events.service.js";

export const EVENTS_STORE = Symbol("EVENTS_STORE");
export const CHECK_INS_STORE = Symbol("CHECK_INS_STORE");

export interface EventsStore {
  create(event: WeMeetEvent): Promise<void>;
  get(id: string): Promise<WeMeetEvent | null>;
  /** Gli eventi più recenti, dal più nuovo: la lista che l'app fa toccare. */
  list(limit: number): Promise<WeMeetEvent[]>;
}

/** Lo stato accumulato di un attendee: il borsellino consegnato finora. */
export interface AttendeeState {
  attendeeName?: string;
  codes: CollectedCode[];
  /** Le sessioni di presenza viste finora, unite fra una consegna e l'altra. */
  sessions: PresenceSession[];
  hostAttested: boolean;
  confirmationTap: boolean;
  gpsInsideSeen: boolean;
}

/**
 * Un fatto osservato dal device, buono solo per capire cosa è successo.
 *
 * Sta fuori dalla cucitura di verifica di proposito: la telemetria arriva da
 * un client non fidato e non deve poter spostare un giudizio. Serve a
 * rispondere alla domanda che i codici non sanno risolvere — «perché fra le
 * 22:21 e le 22:58 non ho sentito niente?» — distinguendo un telefono che
 * dormiva da uno che se n'era andato.
 */
export interface DeviceEvent {
  at: Date;
  kind: string;
  detail?: string;
}

export interface TelemetryStore {
  append(
    eventId: string,
    deviceId: string,
    events: DeviceEvent[],
  ): Promise<void>;
}

export interface CheckInsStore {
  load(eventId: string, deviceId: string): Promise<AttendeeState | null>;
  save(
    eventId: string,
    deviceId: string,
    state: AttendeeState,
    result: AttendeeCheckIn,
  ): Promise<void>;
  list(eventId: string): Promise<AttendeeCheckIn[]>;
}
