import type { AttendeeCheckIn } from "../check-in/check-ins.service.js";
import type { WeMeetEvent } from "../events/events.service.js";
import {
  InMemoryCheckInsStore,
  InMemoryEventsStore,
  InMemoryNotaryDevicesStore,
  InMemoryTelemetryStore,
} from "./in-memory.js";
import {
  PgCheckInsStore,
  PgClient,
  PgEventsStore,
  PgNotaryDevicesStore,
  PgTelemetryStore,
} from "./pg.js";
import type {
  AttendeeState,
  CheckInsStore,
  DeviceEvent,
  EventsStore,
  NotaryDevicesStore,
  TelemetryStore,
} from "./store.js";

/**
 * Selezione dello store rimandata al primo uso, a runtime: alcuni builder
 * (es. NestJS su Vercel) valutano i moduli a build time, dove le env di
 * runtime possono mancare — una lettura top-level resterebbe congelata.
 */
interface Backing {
  kind: "postgres" | "memory";
  events: EventsStore;
  checkIns: CheckInsStore;
  telemetry: TelemetryStore;
  notaryDevices: NotaryDevicesStore;
}

let backing: Backing | null = null;

export function resolveBacking(): Backing {
  if (!backing) {
    const url = process.env.POSTGRES_URL;
    if (url) {
      const client = new PgClient(url);
      backing = {
        kind: "postgres",
        events: new PgEventsStore(client),
        checkIns: new PgCheckInsStore(client),
        telemetry: new PgTelemetryStore(client),
        notaryDevices: new PgNotaryDevicesStore(client),
      };
    } else {
      // I satelliti prima dell'evento: chi cancella deve poterli svuotare.
      const checkIns = new InMemoryCheckInsStore();
      const telemetry = new InMemoryTelemetryStore();
      const notaryDevices = new InMemoryNotaryDevicesStore();
      backing = {
        kind: "memory",
        events: new InMemoryEventsStore([checkIns, telemetry, notaryDevices]),
        checkIns,
        telemetry,
        notaryDevices,
      };
    }
  }
  return backing;
}

export class LazyEventsStore implements EventsStore {
  create(event: WeMeetEvent): Promise<void> {
    return resolveBacking().events.create(event);
  }
  get(id: string): Promise<WeMeetEvent | null> {
    return resolveBacking().events.get(id);
  }
  list(limit: number): Promise<WeMeetEvent[]> {
    return resolveBacking().events.list(limit);
  }
  delete(id: string): Promise<boolean> {
    return resolveBacking().events.delete(id);
  }
}

export class LazyCheckInsStore implements CheckInsStore {
  load(eventId: string, deviceId: string): Promise<AttendeeState | null> {
    return resolveBacking().checkIns.load(eventId, deviceId);
  }
  save(
    eventId: string,
    deviceId: string,
    state: AttendeeState,
    result: AttendeeCheckIn,
  ): Promise<void> {
    return resolveBacking().checkIns.save(eventId, deviceId, state, result);
  }
  list(eventId: string): Promise<AttendeeCheckIn[]> {
    return resolveBacking().checkIns.list(eventId);
  }
}

export class LazyTelemetryStore implements TelemetryStore {
  append(
    eventId: string,
    deviceId: string,
    events: DeviceEvent[],
  ): Promise<void> {
    return resolveBacking().telemetry.append(eventId, deviceId, events);
  }
}
