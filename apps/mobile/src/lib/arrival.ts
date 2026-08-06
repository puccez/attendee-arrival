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
