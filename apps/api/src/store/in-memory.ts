import type { AttendeeCheckIn } from "../check-in/check-ins.service.js";
import type { WeMeetEvent } from "../events/events.service.js";
import type {
  AttendeeState,
  CheckInsStore,
  DeviceEvent,
  EventsStore,
  NotaryDevice,
  NotaryDevicesStore,
  NotaryDeviceStatus,
  TelemetryStore,
} from "./store.js";

/** Ciò che orbita attorno a un evento e deve sparire insieme a lui. */
interface EventScoped {
  dropEvent(eventId: string): void;
}

/** Store in-memory: test e sviluppo locale senza database. */
export class InMemoryEventsStore implements EventsStore {
  private readonly events = new Map<string, WeMeetEvent>();

  /**
   * In Postgres la pulizia delle righe collegate la fa la transazione; qui
   * le mappe vivono in store separati che non si conoscono, quindi i
   * satelliti vanno consegnati alla nascita — chi cancella l'evento li
   * svuota, e nessun vincolo referenziale lo farebbe al posto nostro.
   */
  constructor(private readonly satellites: EventScoped[] = []) {}

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

  async delete(id: string): Promise<boolean> {
    if (!this.events.delete(id)) return false;
    for (const s of this.satellites) s.dropEvent(id);
    return true;
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

  dropEvent(eventId: string): void {
    this.results.delete(eventId);
    for (const key of this.states.keys()) {
      if (key.startsWith(`${eventId}:`)) this.states.delete(key);
    }
  }
}

export class InMemoryNotaryDevicesStore implements NotaryDevicesStore {
  readonly devices = new Map<string, NotaryDevice>();

  async heartbeat(
    deviceId: string,
    status: NotaryDeviceStatus,
    at: Date,
  ): Promise<string | null> {
    const known = this.devices.get(deviceId);
    const device: NotaryDevice = {
      deviceId,
      lastSeenAt: at,
      eventId: known?.eventId ?? null,
      status,
    };
    this.devices.set(deviceId, device);
    return device.eventId;
  }

  async list(): Promise<NotaryDevice[]> {
    return [...this.devices.values()];
  }

  async assign(deviceId: string, eventId: string): Promise<void> {
    const known = this.devices.get(deviceId);
    this.devices.set(deviceId, {
      deviceId,
      lastSeenAt: known?.lastSeenAt ?? null,
      eventId,
      status: known?.status ?? null,
    });
  }

  async unassign(deviceId: string): Promise<boolean> {
    const known = this.devices.get(deviceId);
    if (!known) return false;
    known.eventId = null;
    return true;
  }

  /** L'evento se ne va: il beacon resta nel registro, ma libero. */
  dropEvent(eventId: string): void {
    for (const device of this.devices.values()) {
      if (device.eventId === eventId) device.eventId = null;
    }
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

  dropEvent(eventId: string): void {
    for (const key of this.events.keys()) {
      if (key.startsWith(`${eventId}:`)) this.events.delete(key);
    }
  }
}
