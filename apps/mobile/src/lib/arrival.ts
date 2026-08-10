/**
 * L'annuncio dell'Arrivo scatta sulla transizione, non sullo stato.
 *
 * iOS rigioca «sei dentro» a ogni occasione: quando il task manager
 * ripristina il geofence persistito all'avvio, quando l'app lo ri-registra,
 * quando si accende lo schermo (`notifyEntryStateOnDisplay`). Ogni replica
 * arriva alla task come un Enter — ma l'attendee è arrivato una volta sola,
 * e ogni replica annunciata è una notifica doppia sul suo telefono.
 *
 * Il confine: si annuncia solo l'ingresso di chi risultava fuori. L'uscita
 * rimette fuori, quindi chi esce e rientra viene riannunciato — quella è
 * davvero una transizione. Lo stato memorizzato è l'id dell'evento (non un
 * booleano): cambiare evento invalida da solo il «già dentro» di quello
 * vecchio.
 */
export function shouldAnnounceArrival(
  fenceState: string | null,
  eventId: string,
): boolean {
  return fenceState !== eventId;
}

/**
 * Il paracadute ottico: la mossa da fare a ogni giro di risveglio.
 *
 * La conferma di presenza appartiene al canale radio: «sei arrivato» si
 * dice quando il telefono sente il codice, non a 150 metri. Il cerchio GPS
 * sveglia in silenzio e arma un timer: se il beacon si fa sentire prima, il
 * timer si disinnesca; se resta muto (host in ritardo, Bluetooth spento,
 * beacon guasto), la notifica che parte instrada sul codice a mano.
 *
 * Un paracadute per ingresso: i replay di iOS trovano il timer già armato e
 * non lo riarmano. L'uscita dal cerchio lo disinnesca fuori da qui — chi se
 * ne va prima di entrare non riceve nessun invito.
 */
export function opticalFallbackMove(options: {
  /** Questo giro sta annunciando via canale radio (region o receiver). */
  announcing: boolean;
  /** Lo stato di transizione DOPO il drain: l'annuncio nativo vi è già piegato. */
  fenceState: string | null;
  eventId: string;
  /** Codici drenati in questo giro: radio viva anche senza annuncio. */
  collectedNow: number;
  /** Un paracadute è già armato da un giro precedente. */
  pendingFallback: boolean;
  /** Il giro nasce da un ingresso nel cerchio GPS. */
  gpsEntry: boolean;
  /** Il giro nasce dall'uscita dal cerchio: vince su tutto, si disinnesca. */
  gpsExit: boolean;
}): "arma" | "disinnesca" | "niente" {
  if (options.gpsExit) return options.pendingFallback ? "disinnesca" : "niente";
  const radioReached =
    options.announcing ||
    options.collectedNow > 0 ||
    options.fenceState === options.eventId;
  if (radioReached) return options.pendingFallback ? "disinnesca" : "niente";
  if (options.gpsEntry && !options.pendingFallback) return "arma";
  return "niente";
}
