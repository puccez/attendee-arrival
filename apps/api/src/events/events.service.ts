import { randomBytes, randomUUID } from "node:crypto";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { EventWindow } from "@attendee-arrival/core";
import { EVENTS_STORE, type EventsStore } from "../store/store.js";

export interface WeMeetEvent extends EventWindow {
  name: string;
  geofence?: { lat: number; lng: number; radiusM: number };
}

/**
 * Gli eventi e il loro seme. Il seme è per-evento e nasce qui:
 * non lascia il server se non verso la console dell'evento (beacon-notaio).
 */
@Injectable()
export class EventsService {
  constructor(@Inject(EVENTS_STORE) private readonly store: EventsStore) {}

  async create(input: {
    name: string;
    startsAt: Date;
    endsAt: Date;
    geofence?: { lat: number; lng: number; radiusM: number };
  }): Promise<WeMeetEvent> {
    const event: WeMeetEvent = {
      id: randomUUID(),
      seed: randomBytes(32).toString("hex"),
      ...input,
    };
    await this.store.create(event);
    return event;
  }

  async get(id: string): Promise<WeMeetEvent> {
    const event = await this.store.get(id);
    if (!event) throw new NotFoundException(`Evento sconosciuto: ${id}`);
    return event;
  }

  async list(limit = 30): Promise<WeMeetEvent[]> {
    return this.store.list(limit);
  }
}
