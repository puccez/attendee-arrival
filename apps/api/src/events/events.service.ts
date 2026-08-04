import { randomBytes, randomUUID } from "node:crypto";
import { Injectable, NotFoundException } from "@nestjs/common";
import type { EventWindow } from "@attendee-arrival/core";

export interface WeMeetEvent extends EventWindow {
  name: string;
  geofence?: { lat: number; lng: number; radiusM: number };
}

/**
 * Store in-memory degli eventi (demo). Il seme è per-evento e nasce qui:
 * non lascia il server se non verso la console dell'evento (beacon-notaio).
 */
@Injectable()
export class EventsService {
  private readonly events = new Map<string, WeMeetEvent>();

  create(input: {
    name: string;
    startsAt: Date;
    endsAt: Date;
    geofence?: { lat: number; lng: number; radiusM: number };
  }): WeMeetEvent {
    const event: WeMeetEvent = {
      id: randomUUID(),
      seed: randomBytes(32).toString("hex"),
      ...input,
    };
    this.events.set(event.id, event);
    return event;
  }

  get(id: string): WeMeetEvent {
    const event = this.events.get(id);
    if (!event) throw new NotFoundException(`Evento sconosciuto: ${id}`);
    return event;
  }
}
