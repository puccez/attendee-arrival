import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";

import { WemeetBeacon } from "../modules/wemeet-beacon";
import { opticalFallbackMove, shouldAnnounceArrival } from "./lib/arrival";
import { ARRIVAL_FALLBACK_DELAY_S, BEACON_UUID } from "./lib/config";
import {
  cancelOpticalFallback,
  presentArrival,
  scheduleOpticalFallback,
} from "./lib/notifications";
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
/** L'id della notifica-paracadute programmata, "" se non ce n'è una armata. */
export const SETTING_FALLBACK_ID = "fallback-notification";

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
    // Se il receiver nativo ha già annunciato l'arrivo (Android, app
    // chiusa), quell'annuncio conta: si piega nello stato di transizione
    // e i risvegli rigiocati da geofence e region tacciono — un annuncio,
    // qualunque sia la strada.
    if (await WemeetBeacon.consumeNativeArrivalAsync()) {
      await writeSetting(SETTING_FENCE_STATE, eventId);
      await logDeviceEvent(eventId, "annuncio_nativo", "aveva già annunciato il sistema");
    }
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

/**
 * Un giro completo di risveglio: raccogli, notifica, consegna.
 *
 * I giri si mettono in fila, ed è un confine di correttezza: alla scelta
 * dell'evento geofence, region e replay dello stato iniziale svegliano tutti
 * insieme, e il controllo «risultavi già dentro?» è un leggi-poi-scrivi —
 * tre giri intrecciati leggono tutti «fuori» prima che il primo scriva
 * «dentro», e l'annuncio parte tre volte. In fila, il primo annuncia e gli
 * altri trovano lo stato già scritto.
 */
let arrivalTurn: Promise<void> = Promise.resolve();

interface ArrivalOptions {
  gpsInside: boolean;
  /** Annuncia la conferma: solo i risvegli del canale radio la portano. */
  notify: boolean;
  /** Il giro nasce da un ingresso nel cerchio GPS: arma il paracadute ottico. */
  scheduleFallback?: boolean;
  /** Il giro nasce dall'uscita dal cerchio: chi se ne va non va invitato. */
  gpsExit?: boolean;
  reason?: string;
}

export function handleArrival(options: ArrivalOptions): Promise<void> {
  const turn = arrivalTurn.then(() => arrivalRound(options));
  arrivalTurn = turn.catch(() => {});
  return turn;
}

/** Disinnesca la notifica-paracadute, se ce n'è una armata. */
async function disarmOpticalFallback(
  eventId: string,
  reason: string,
): Promise<void> {
  const pending = await readSetting(SETTING_FALLBACK_ID);
  if (!pending) return;
  await cancelOpticalFallback(pending);
  await writeSetting(SETTING_FALLBACK_ID, "");
  await logDeviceEvent(eventId, "paracadute_disinnescato", reason);
}

async function arrivalRound(options: ArrivalOptions): Promise<void> {
  const eventId = await readSetting(SETTING_EVENT_ID);
  if (!eventId) return;

  await logDeviceEvent(eventId, "wake", options.reason ?? "sconosciuto");
  const collected = await drainRadioBacklog(eventId);
  if (options.gpsInside) {
    await markArrival(eventId, { gpsInside: true });
  }

  // Letto DOPO il drain: l'annuncio del receiver nativo vi si è già piegato.
  const fenceState = await readSetting(SETTING_FENCE_STATE);

  if (options.notify) {
    // L'annuncio scatta sulla transizione, non sullo stato: iOS rigioca
    // «sei dentro» a ogni ripristino del task e a ogni riaccensione dello
    // schermo, e ogni replica annunciata è una notifica doppia.
    if (shouldAnnounceArrival(fenceState, eventId)) {
      const eventName = (await readSetting(SETTING_EVENT_NAME)) ?? "il WeMeet";
      await presentArrival(eventId, eventName).catch(() => {});
      await logDeviceEvent(eventId, "notifica_mostrata");
    } else {
      await logDeviceEvent(eventId, "notifica_taciuta", "risultavi già dentro");
    }
    await writeSetting(SETTING_FENCE_STATE, eventId);
    // Lo specchio nativo (Android): finché risulti dentro, anche il
    // receiver ad app chiusa tace.
    await WemeetBeacon?.syncArrivalStateAsync(true).catch(() => {});
  }

  // Il paracadute ottico: il cerchio GPS lo arma, il canale radio lo
  // disinnesca (la mossa e i suoi perché stanno in lib/arrival).
  const pendingFallback = await readSetting(SETTING_FALLBACK_ID);
  const move = opticalFallbackMove({
    announcing: options.notify,
    fenceState,
    eventId,
    collectedNow: collected,
    pendingFallback: Boolean(pendingFallback),
    gpsEntry: options.scheduleFallback === true,
    gpsExit: options.gpsExit === true,
  });
  if (move === "disinnesca") {
    await disarmOpticalFallback(
      eventId,
      options.gpsExit ? "uscito dal cerchio GPS" : "il canale radio si è fatto sentire",
    );
  } else if (move === "arma") {
    const eventName = (await readSetting(SETTING_EVENT_NAME)) ?? "il WeMeet";
    const scheduled = await scheduleOpticalFallback(
      eventId,
      eventName,
      ARRIVAL_FALLBACK_DELAY_S,
    );
    if (scheduled) {
      await writeSetting(SETTING_FALLBACK_ID, scheduled);
      await logDeviceEvent(
        eventId,
        "paracadute_armato",
        `canale ottico fra ${ARRIVAL_FALLBACK_DELAY_S} secondi`,
      );
    }
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
    // L'Arrivo: dichiarazione di posizione, non prova — e nemmeno annuncio.
    // Il cerchio sveglia in silenzio, apre la caccia ai codici e arma il
    // paracadute ottico; «sei arrivato» lo dice solo il canale radio,
    // quando il telefono sente davvero il codice.
    await handleArrival({
      gpsInside: true,
      notify: false,
      scheduleFallback: true,
      reason: "geofence_ingresso",
    });
  } else if (eventType === Location.GeofencingEventType.Exit) {
    // All'uscita si campiona un'ultima volta: è l'altro estremo del dwell.
    // E si torna «fuori»: il prossimo ingresso è una transizione vera,
    // quindi verrà riannunciato — anche dal receiver nativo, che si riarma.
    await writeSetting(SETTING_FENCE_STATE, "");
    await WemeetBeacon?.syncArrivalStateAsync(false).catch(() => {});
    await handleArrival({
      gpsInside: false,
      notify: false,
      gpsExit: true,
      reason: "geofence_uscita",
    });
  }
});

/*
 * La region del beacon delimita la presenza — e per gli eventi itineranti È
 * il geofence: mobile, centrato su chi emette.
 *
 * Un beacon non-connettibile non può dirci quando te ne vai: non ti vede
 * nemmeno. Ma CoreLocation sì — `didExitRegion` è l'unico segnale di fine
 * presenza che abbiamo, l'equivalente del disconnect BLE. Senza queste
 * righe la copertura misurerebbe l'arco fra il primo e l'ultimo codice, e
 * conterebbe come permanenza anche il tempo passato dall'altra parte della
 * città.
 *
 * L'ingresso in region è anche l'altro innesco dell'Arrivo: a una
 * passeggiata di due chilometri il cerchio GPS disegnato alla creazione è
 * carta straccia, e chi raggiunge il gruppo in ritardo viene svegliato dal
 * beacon, non da un punto sulla mappa. Entrambi gli inneschi passano dallo
 * stesso stato di transizione (lib/arrival): qualunque cosa ti abbia
 * svegliato, l'annuncio è uno.
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
    await handleArrival({
      gpsInside: false,
      notify: true,
      reason: "region_ingresso",
    });
  })();
});

WemeetBeacon?.addListener("onRegionExit", () => {
  void (async () => {
    const eventId = await readSetting(SETTING_EVENT_ID);
    if (!eventId) return;
    await logDeviceEvent(eventId, "region_uscita");
    await closePresenceSession(eventId);
    // Senza geofence GPS la region è il confine: uscirne — con un notaio
    // mobile significa «l'evento è uscito da te» — rimette fuori, e il
    // prossimo ingresso è una transizione vera da riannunciare. Quando un
    // geofence GPS c'è, il confine resta suo: un buco radio di 45 secondi
    // dentro il locale non deve riarmare la notifica.
    if (!(await readSetting(SETTING_FENCE_REGION))) {
      await writeSetting(SETTING_FENCE_STATE, "");
      await WemeetBeacon?.syncArrivalStateAsync(false).catch(() => {});
    }
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
  // evento registra da capo e riannuncia — receiver nativo compreso.
  // E nessun paracadute superstite: un invito a un evento lasciato è spam.
  const pending = await readSetting(SETTING_FALLBACK_ID);
  if (pending) {
    await cancelOpticalFallback(pending);
    await writeSetting(SETTING_FALLBACK_ID, "");
  }
  await writeSetting(SETTING_FENCE_STATE, "");
  await writeSetting(SETTING_FENCE_REGION, "");
  await WemeetBeacon?.syncArrivalStateAsync(false).catch(() => {});
}
