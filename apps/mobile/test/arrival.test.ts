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
