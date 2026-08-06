import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";

import { WemeetBeacon } from "../modules/wemeet-beacon";
import { shouldAnnounceArrival } from "./lib/arrival";
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
  writeSetting,
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
/** L'id dell'evento in cui risultiamo dentro, "" se fuori: vedi lib/arrival. */
export const SETTING_FENCE_STATE = "fence-state";
/** La firma della region registrata: ri-registrare senza motivo rigioca lo stato iniziale. */
export const SETTING_FENCE_REGION = "fence-region";

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
    // L'annuncio scatta sulla transizione, non sullo stato: iOS rigioca
    // «sei dentro» a ogni ripristino del task e a ogni riaccensione dello
    // schermo, e ogni replica annunciata è una notifica doppia.
    if (shouldAnnounceArrival(await readSetting(SETTING_FENCE_STATE), eventId)) {
      const eventName = (await readSetting(SETTING_EVENT_NAME)) ?? "il WeMeet";
      await presentArrival(eventId, eventName).catch(() => {});
      await logDeviceEvent(eventId, "notifica_mostrata");
    } else {
      await logDeviceEvent(eventId, "notifica_taciuta", "risultavi già dentro");
    }
    await writeSetting(SETTING_FENCE_STATE, eventId);
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
    // E si torna «fuori»: il prossimo ingresso è una transizione vera,
    // quindi verrà riannunciato.
    await writeSetting(SETTING_FENCE_STATE, "");
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
  // Registrare è idempotente solo in apparenza: ogni registrazione chiede
  // al sistema lo stato iniziale, e se sei già dentro quello stato torna
  // alla task come un Enter. L'app chiama questa funzione a ogni apertura —
  // se la region è la stessa e il task già corre, non c'è niente da fare.
  const signature = `${geofence.lat},${geofence.lng},${geofence.radiusM}`;
  const running = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK).catch(
    () => false,
  );
  if (running && (await readSetting(SETTING_FENCE_REGION)) === signature) return;

  await Location.startGeofencingAsync(GEOFENCE_TASK, [
    {
      latitude: geofence.lat,
      longitude: geofence.lng,
      radius: Math.max(geofence.radiusM, 100), // sotto i 100 m Android è inaffidabile
      notifyOnEnter: true,
      notifyOnExit: true,
    },
  ]);
  await writeSetting(SETTING_FENCE_REGION, signature);
}

export async function stopGeofence(): Promise<void> {
  if (await TaskManager.isTaskRegisteredAsync(GEOFENCE_TASK)) {
    await Location.stopGeofencingAsync(GEOFENCE_TASK).catch(() => {});
  }
  // Fine dell'evento: fuori dalla region e senza firma, così il prossimo
  // evento registra da capo e riannuncia.
  await writeSetting(SETTING_FENCE_STATE, "");
  await writeSetting(SETTING_FENCE_REGION, "");
}
