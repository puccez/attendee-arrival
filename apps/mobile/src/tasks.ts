import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";

import { WemeetBeacon } from "../modules/wemeet-beacon";
import { BEACON_UUID } from "./lib/config";
import { presentArrival } from "./lib/notifications";
import { normalizeSighting } from "./beacon/normalize";
import {
  closePresenceSession,
  collectCode,
  flush,
  flushTelemetry,
  getDeviceId,
  logDeviceEvent,
  markArrival,
  openPresenceSession,
  readSetting,
} from "./wallet/wallet";

/**
 * I task che il sistema esegue quando l'app non è in primo piano.
 *
 * Vanno registrati al caricamento del modulo, prima di React: quando iOS o
 * Android risvegliano il processo per un evento di geofence non c'è
 * nessuna UI, solo questo file.
 *
 * Il risveglio dà una manciata di secondi. Ne bastano per: drenare gli
 * avvistamenti accumulati, mettere i codici nel borsellino, far scattare la
 * notifica one-tap e provare la consegna. Se la rete non c'è, il borsellino
 * aspetta — offline non è un caso d'errore.
 */

export const GEOFENCE_TASK = "wemeet-geofence";

export const SETTING_EVENT_ID = "event-id";
export const SETTING_EVENT_NAME = "event-name";

/**
 * Porta nel borsellino tutto ciò che il canale radio ha accumulato mentre
 * l'app non era viva (Android). Su iOS la coda è sempre vuota: lì il
 * risveglio consegna gli eventi direttamente al processo.
 */
export async function drainRadioBacklog(eventId: string): Promise<number> {
  if (!WemeetBeacon) return 0;
  let collected = 0;
  let seen = 0;
  try {
    const backlog = await WemeetBeacon.drainBackgroundSightingsAsync();
    for (const raw of backlog) {
      const sighting = normalizeSighting(raw, BEACON_UUID);
      if (!sighting?.code) continue;
      seen++;
      if (await collectCode(eventId, sighting.code, sighting.at)) collected++;
    }
  } catch (error) {
    // Modulo assente o Bluetooth spento: l'app resta utilizzabile.
    await logDeviceEvent(eventId, "radio_error", String(error).slice(0, 200));
  }
  // Anche (soprattutto) lo zero va detto: è la riga che spiega un silenzio.
  await logDeviceEvent(eventId, "radio_drain", `visti=${seen} nuovi=${collected}`);
  return collected;
}

/** Un giro completo di risveglio: raccogli, notifica, consegna. */
export async function handleArrival(options: {
  gpsInside: boolean;
  notify: boolean;
  reason?: string;
}): Promise<void> {
  const eventId = await readSetting(SETTING_EVENT_ID);
  if (!eventId) return;

  await logDeviceEvent(eventId, "wake", options.reason ?? "sconosciuto");
  await drainRadioBacklog(eventId);
  if (options.gpsInside) {
    await markArrival(eventId, { gpsInside: true });
  }

  if (options.notify) {
    const eventName = (await readSetting(SETTING_EVENT_NAME)) ?? "il WeMeet";
    await presentArrival(eventId, eventName).catch(() => {});
    await logDeviceEvent(eventId, "notifica_mostrata");
  }

  const deviceId = await getDeviceId();
  const report = await flush(deviceId).catch(() => null);
  await logDeviceEvent(
    eventId,
    report ? "consegna" : "consegna_fallita",
    report ? `consegnati=${report.delivered} in_attesa=${report.retryLater}` : undefined,
  );
  await flushTelemetry(eventId, deviceId).catch(() => 0);
}

TaskManager.defineTask(GEOFENCE_TASK, async ({ data, error }) => {
  if (error) return;
  const { eventType } = (data ?? {}) as {
    eventType?: Location.GeofencingEventType;
  };
  if (eventType === Location.GeofencingEventType.Enter) {
    // L'Arrivo: dichiarazione di posizione, non prova. Innesca la notifica
    // e apre la caccia ai codici — non produce nessun check-in da solo.
    await handleArrival({
      gpsInside: true,
      notify: true,
      reason: "geofence_ingresso",
    });
  } else if (eventType === Location.GeofencingEventType.Exit) {
    // All'uscita si campiona un'ultima volta: è l'altro estremo del dwell.
    await handleArrival({
      gpsInside: false,
      notify: false,
      reason: "geofence_uscita",
    });
  }
});

/*
 * La region del beacon delimita la presenza.
 *
 * Un beacon non-connettibile non può dirci quando te ne vai: non ti vede
 * nemmeno. Ma CoreLocation sì — `didExitRegion` è l'unico segnale di fine
 * presenza che abbiamo, l'equivalente del disconnect BLE. Senza queste due
 * righe la copertura misurerebbe l'arco fra il primo e l'ultimo codice, e
 * conterebbe come permanenza anche il tempo passato dall'altra parte della
 * città.
 *
 * Come i task, si registrano qui e non in React: gli ingressi e le uscite
 * arrivano quando l'interfaccia non è viva.
 */
WemeetBeacon?.addListener("onRegionEnter", () => {
  void (async () => {
    const eventId = await readSetting(SETTING_EVENT_ID);
    if (!eventId) return;
    await logDeviceEvent(eventId, "region_ingresso");
    await openPresenceSession(eventId);
  })();
});

WemeetBeacon?.addListener("onRegionExit", () => {
  void (async () => {
    const eventId = await readSetting(SETTING_EVENT_ID);
    if (!eventId) return;
    await logDeviceEvent(eventId, "region_uscita");
    await closePresenceSession(eventId);
    // La chiusura vale quanto la raccolta: si prova a consegnarla subito.
    const deviceId = await getDeviceId();
    await flush(deviceId).catch(() => {});
    await flushTelemetry(eventId, deviceId).catch(() => 0);
  })();
});

/** Attiva il geofence dell'evento: è ciò che sveglia l'app all'arrivo. */
export async function startGeofence(geofence: {
  lat: number;
  lng: number;
  radiusM: number;
}): Promise<void> {
  await Location.startGeofencingAsync(GEOFENCE_TASK, [
    {
      latitude: geofence.lat,
      longitude: geofence.lng,
      radius: Math.max(geofence.radiusM, 100), // sotto i 100 m Android è inaffidabile
      notifyOnEnter: true,
      notifyOnExit: true,
    },
  ]);
}

export async function stopGeofence(): Promise<void> {
  if (await TaskManager.isTaskRegisteredAsync(GEOFENCE_TASK)) {
    await Location.stopGeofencingAsync(GEOFENCE_TASK).catch(() => {});
  }
}
