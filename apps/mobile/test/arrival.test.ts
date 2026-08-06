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
 * Il trigger unificato: la notifica one-tap può innescarla sia il geofence
 * GPS sia l'ingresso nella region del beacon (modalità notaio, eventi
 * itineranti). I due inneschi condividono lo stesso stato di transizione,
 * quindi qualunque coppia di risvegli nella stessa bolla vale un annuncio.
 *
 * La simulazione replica la disciplina di src/tasks.ts: chi passa dal ramo
 * notify scrive «dentro» comunque sia andata; l'uscita dal confine attivo
 * scrive «fuori».
 */

function simulate(
  triggers: ("geofence" | "region" | "uscita")[],
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
