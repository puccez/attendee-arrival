import { Injectable } from "@nestjs/common";
import {
  evaluateDelivery,
  type CheckIn,
  type CollectedCode,
} from "@attendee-arrival/core";
import type { WeMeetEvent } from "../events/events.service.js";

export interface DeliveryInput {
  deviceId: string;
  attendeeName?: string;
  codes: CollectedCode[];
  gps?: { insideGeofence: boolean };
  hostAttested?: boolean;
  confirmationTap?: boolean;
}

export interface AttendeeCheckIn extends CheckIn {
  attendeeName?: string;
  updatedAt: Date;
}

interface AttendeeState {
  attendeeName?: string;
  codes: Map<string, CollectedCode>;
  hostAttested: boolean;
  confirmationTap: boolean;
  gpsInsideSeen: boolean;
}

/**
 * Accumula le consegne per (evento, device) e ri-valuta l'unione col core:
 * il borsellino consegna a rate e il dwell cresce a ogni scansione.
 * Store in-memory (demo); la persistenza arriverà con Supabase.
 */
@Injectable()
export class CheckInsService {
  private readonly byEvent = new Map<string, Map<string, AttendeeState>>();
  private readonly results = new Map<string, Map<string, AttendeeCheckIn>>();

  record(
    event: WeMeetEvent,
    input: DeliveryInput,
    deliveredAt: Date,
  ): AttendeeCheckIn {
    const attendees = getOrCreate(this.byEvent, event.id);
    const state = attendees.get(input.deviceId) ?? {
      codes: new Map<string, CollectedCode>(),
      hostAttested: false,
      confirmationTap: false,
      gpsInsideSeen: false,
    };

    for (const code of input.codes) state.codes.set(code.value, code);
    state.hostAttested ||= input.hostAttested === true;
    state.confirmationTap ||= input.confirmationTap === true;
    state.gpsInsideSeen ||= input.gps?.insideGeofence === true;
    state.attendeeName = input.attendeeName ?? state.attendeeName;
    attendees.set(input.deviceId, state);

    const checkIn = evaluateDelivery({
      event,
      deviceId: input.deviceId,
      codes: [...state.codes.values()],
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
    getOrCreate(this.results, event.id).set(input.deviceId, result);
    return result;
  }

  list(eventId: string): AttendeeCheckIn[] {
    return [...(this.results.get(eventId)?.values() ?? [])];
  }
}

function getOrCreate<V>(map: Map<string, Map<string, V>>, key: string) {
  let inner = map.get(key);
  if (!inner) {
    inner = new Map();
    map.set(key, inner);
  }
  return inner;
}
