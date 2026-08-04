import type { CollectedCode } from "@attendee-arrival/core";
import type { AttendeeCheckIn } from "../check-in/check-ins.service.js";
import type { WeMeetEvent } from "../events/events.service.js";

export const EVENTS_STORE = Symbol("EVENTS_STORE");
export const CHECK_INS_STORE = Symbol("CHECK_INS_STORE");

export interface EventsStore {
  create(event: WeMeetEvent): Promise<void>;
  get(id: string): Promise<WeMeetEvent | null>;
}

/** Lo stato accumulato di un attendee: il borsellino consegnato finora. */
export interface AttendeeState {
  attendeeName?: string;
  codes: CollectedCode[];
  hostAttested: boolean;
  confirmationTap: boolean;
  gpsInsideSeen: boolean;
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
