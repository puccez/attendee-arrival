import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { CLOCK, type Clock } from "../clock.js";
import { EventsService, type WeMeetEvent } from "../events/events.service.js";
import { resolveBacking } from "../store/lazy.js";
import type { NotaryDevice, NotaryDeviceStatus } from "../store/store.js";

/** La riga che il web vede: il seme NON c'è, e non per dimenticanza. */
export interface NotaryDevicePublic {
  deviceId: string;
  lastSeenAt: string | null;
  status: NotaryDeviceStatus | null;
  event: { id: string; name: string } | null;
}

/**
 * I beacon fissi e i loro incarichi. Il verso è sempre pull: l'ESP32 sta
 * dietro NAT e nessuno può bussargli — il web scrive l'incarico nel
 * registro, il battito successivo del device lo raccoglie. «Connesso
 * adesso» è quindi una definizione, non uno stato: un battito recente.
 */
@Injectable()
export class NotaryDevicesService {
  constructor(
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Il battito del device: ritorna l'evento dell'incarico, seme compreso —
   * questa è la porta del seme dei beacon fissi, gemella di GET /seed.
   * Se l'evento assegnato non esiste più (cancellato fra un battito e
   * l'altro con uno store che non ha fatto pulizia), l'incarico decade qui.
   */
  async heartbeat(
    deviceId: string,
    status: NotaryDeviceStatus,
  ): Promise<WeMeetEvent | null> {
    const store = resolveBacking().notaryDevices;
    const eventId = await store.heartbeat(deviceId, status, this.clock.now());
    if (!eventId) return null;
    const event = await resolveBacking().events.get(eventId);
    if (!event) {
      await store.unassign(deviceId);
      return null;
    }
    return event;
  }

  /** La lista per il web: righe pubbliche, con il nome dell'evento accanto. */
  async list(): Promise<NotaryDevicePublic[]> {
    const devices = await resolveBacking().notaryDevices.list();
    const named = new Map<string, string>();
    for (const device of devices) {
      if (device.eventId && !named.has(device.eventId)) {
        const event = await resolveBacking().events.get(device.eventId);
        if (event) named.set(device.eventId, event.name);
      }
    }
    return devices.map((device: NotaryDevice) => ({
      deviceId: device.deviceId,
      lastSeenAt: device.lastSeenAt ? device.lastSeenAt.toISOString() : null,
      status: device.status,
      event:
        device.eventId && named.has(device.eventId)
          ? { id: device.eventId, name: named.get(device.eventId)! }
          : null,
    }));
  }

  /** L'incarico: l'evento deve esistere, il device può non essersi mai visto. */
  async assign(deviceId: string, eventId: string): Promise<void> {
    await this.events.get(eventId); // 404 se sconosciuto
    await resolveBacking().notaryDevices.assign(deviceId, eventId);
  }

  async unassign(deviceId: string): Promise<void> {
    const known = await resolveBacking().notaryDevices.unassign(deviceId);
    if (!known) {
      throw new NotFoundException(`Beacon sconosciuto: ${deviceId}`);
    }
  }
}
