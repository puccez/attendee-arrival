import assert from "node:assert/strict";
import test from "node:test";

import { shouldAnnounceArrival } from "../src/lib/arrival.ts";

/**
 * Il bug che questo file inchioda: aprire l'app dentro il raggio faceva
 * arrivare due notifiche di conferma. iOS rigioca «sei dentro» quando il
 * task manager ripristina il geofence e quando l'app lo ri-registra — due
 * Enter nella stessa apertura, nessuno dei due un arrivo.
 */

test("il primo ingresso si annuncia", () => {
  assert.equal(shouldAnnounceArrival(null, "evento-a"), true, "stato mai scritto");
  assert.equal(shouldAnnounceArrival("", "evento-a"), true, "risultavi fuori");
});

test("lo stato rigiocato non si riannuncia", () => {
  // Il replay di iOS: task ripristinato, poi ri-registrato, poi schermo
  // acceso. Tre Enter, un solo arrivo — già annunciato.
  assert.equal(shouldAnnounceArrival("evento-a", "evento-a"), false);
});

test("uscire e rientrare è una transizione vera", () => {
  // L'uscita scrive "": il rientro parte da fuori.
  assert.equal(shouldAnnounceArrival("", "evento-a"), true);
});

test("cambiare evento invalida il «già dentro» di quello vecchio", () => {
  assert.equal(shouldAnnounceArrival("evento-a", "evento-b"), true);
});

/*
 * Il trigger unificato: la notifica one-tap può innescarla il geofence
 * GPS, l'ingresso nella region del beacon (modalità notaio, eventi
 * itineranti) o — su Android, ad app chiusa — il receiver nativo. Tutte le
 * strade condividono lo stesso stato di transizione, quindi qualunque
 * combinazione di risvegli nella stessa bolla vale UN annuncio.
 *
 * La simulazione replica la disciplina di src/tasks.ts: chi annuncia
 * scrive «dentro» comunque sia andata; l'uscita dal confine attivo scrive
 * «fuori». La strada nativa vi partecipa attraverso lo specchio in
 * BeaconStore: l'annuncio del receiver si piega nello stato al risveglio
 * (`annuncio_nativo`), e l'annuncio JS silenzia il receiver
 * (`syncArrivalStateAsync`) — per il contratto è un trigger come gli altri.
 */

function simulate(
  triggers: ("geofence" | "region" | "nativa" | "uscita")[],
  eventId: string,
): number {
  let fenceState: string | null = null;
  let announced = 0;
  for (const trigger of triggers) {
    if (trigger === "uscita") {
      fenceState = "";
      continue;
    }
    if (shouldAnnounceArrival(fenceState, eventId)) announced++;
    fenceState = eventId;
  }
  return announced;
}

test("geofence e region nella stessa bolla producono un solo annuncio", () => {
  // Al locale: il cerchio GPS scatta per primo, il beacon subito dopo.
  assert.equal(simulate(["geofence", "region"], "evento-a"), 1);
  // In ritardo a una passeggiata: sveglia il beacon, il GPS arriva dopo.
  assert.equal(simulate(["region", "geofence"], "evento-a"), 1);
  // iOS rigioca lo stato a ogni accensione dello schermo: sempre uno.
  assert.equal(simulate(["region", "region", "geofence", "region"], "evento-a"), 1);
});

test("all'evento itinerante l'uscita dalla region riarma l'annuncio", () => {
  // Lasci il gruppo a metà passeggiata («l'evento è uscito da te») e lo
  // raggiungi di nuovo: quella è una transizione vera, si riannuncia.
  assert.equal(simulate(["region", "uscita", "region"], "evento-a"), 2);
});

test("la notifica nativa Android è L'annuncio, non un altro", () => {
  // Il receiver annuncia ad app chiusa; al risveglio si piega nello stato:
  // geofence e region rigiocati trovano «già dentro» e tacciono.
  assert.equal(simulate(["nativa", "geofence", "region"], "evento-a"), 1);
  // E al contrario: se ha annunciato il JS, lo specchio armato tiene muto
  // il receiver. Una bolla, un annuncio, tre strade.
  assert.equal(simulate(["geofence", "nativa"], "evento-a"), 1);
  // L'uscita riarma tutte e tre le strade insieme.
  assert.equal(simulate(["nativa", "uscita", "geofence"], "evento-a"), 2);
});
