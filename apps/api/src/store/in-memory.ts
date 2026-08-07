import type { AttendeeCheckIn } from "../check-in/check-ins.service.js";
import type { WeMeetEvent } from "../events/events.service.js";
import type {
  AttendeeState,
  CheckInsStore,
  DeviceEvent,
  EventsStore,
  TelemetryStore,
} from "./store.js";

/** Store in-memory: test e sviluppo locale senza database. */
export class InMemoryEventsStore implements EventsStore {
  private readonly events = new Map<string, WeMeetEvent>();

  async create(event: WeMeetEvent): Promise<void> {
    this.events.set(event.id, event);
  }

  async get(id: string): Promise<WeMeetEvent | null> {
    return this.events.get(id) ?? null;
  }

  async list(limit: number): Promise<WeMeetEvent[]> {
    return [...this.events.values()]
      .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())
      .slice(0, limit);
  }
}

export class InMemoryCheckInsStore implements CheckInsStore {
  private readonly states = new Map<string, AttendeeState>();
  private readonly results = new Map<string, Map<string, AttendeeCheckIn>>();

  async load(eventId: string, deviceId: string): Promise<AttendeeState | null> {
    return this.states.get(`${eventId}:${deviceId}`) ?? null;
  }

  async save(
    eventId: string,
    deviceId: string,
    state: AttendeeState,
    result: AttendeeCheckIn,
  ): Promise<void> {
    this.states.set(`${eventId}:${deviceId}`, state);
    let byDevice = this.results.get(eventId);
    if (!byDevice) {
      byDevice = new Map();
      this.results.set(eventId, byDevice);
    }
    byDevice.set(deviceId, result);
  }

  async list(eventId: string): Promise<AttendeeCheckIn[]> {
    return [...(this.results.get(eventId)?.values() ?? [])];
  }
}

export class InMemoryTelemetryStore implements TelemetryStore {
  readonly events = new Map<string, DeviceEvent[]>();

  append(
    eventId: string,
    deviceId: string,
    events: DeviceEvent[],
  ): Promise<void> {
    const key = `${eventId}:${deviceId}`;
    this.events.set(key, [...(this.events.get(key) ?? []), ...events]);
    return Promise.resolve();
  }
}
