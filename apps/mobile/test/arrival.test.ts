import assert from "node:assert/strict";
import test from "node:test";

import { opticalFallbackMove, shouldAnnounceArrival } from "../src/lib/arrival.ts";

/*
 * Due discipline, un contratto.
 *
 * 1. L'annuncio scatta sulla transizione, non sullo stato: iOS rigioca
 *    «sei dentro» quando il task manager ripristina il geofence e quando
 *    l'app lo ri-registra — replay, non arrivi. (Il bug inchiodato: due
 *    notifiche di conferma aprendo l'app dentro il raggio.)
 *
 * 2. L'annuncio appartiene al canale radio: «sei arrivato» si dice quando
 *    il telefono sente il codice, non a 150 metri. Il cerchio GPS sveglia
 *    in silenzio e arma il paracadute ottico; il beacon che si fa sentire
 *    lo disinnesca, il beacon che resta muto lo lascia partire.
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

/* ------------------------------------------------ il paracadute ottico */

const quiete = {
  announcing: false,
  fenceState: "" as string | null,
  eventId: "evento-a",
  collectedNow: 0,
  pendingFallback: false,
  gpsEntry: false,
  gpsExit: false,
};

test("l'ingresso GPS a radio muta arma il paracadute", () => {
  assert.equal(opticalFallbackMove({ ...quiete, gpsEntry: true }), "arma");
});

test("un paracadute per ingresso: il replay non riarma", () => {
  assert.equal(
    opticalFallbackMove({ ...quiete, gpsEntry: true, pendingFallback: true }),
    "niente",
  );
});

test("il canale radio disinnesca, in tutte le sue forme", () => {
  // L'annuncio di questo giro (region del beacon).
  assert.equal(
    opticalFallbackMove({ ...quiete, announcing: true, pendingFallback: true }),
    "disinnesca",
  );
  // L'annuncio nativo di un giro passato, già piegato nello stato.
  assert.equal(
    opticalFallbackMove({ ...quiete, fenceState: "evento-a", pendingFallback: true }),
    "disinnesca",
  );
  // Nessun annuncio, ma codici drenati: la radio è viva comunque.
  assert.equal(
    opticalFallbackMove({ ...quiete, collectedNow: 3, pendingFallback: true }),
    "disinnesca",
  );
});

test("chi esce dal cerchio non va invitato a niente", () => {
  assert.equal(
    opticalFallbackMove({ ...quiete, gpsExit: true, pendingFallback: true }),
    "disinnesca",
  );
  // E se non c'era niente di armato, niente da fare.
  assert.equal(opticalFallbackMove({ ...quiete, gpsExit: true }), "niente");
});

test("radio già sentita e niente armato: nessuna mossa", () => {
  assert.equal(
    opticalFallbackMove({ ...quiete, gpsEntry: true, fenceState: "evento-a" }),
    "niente",
  );
});

/*
 * La simulazione replica la disciplina di src/tasks.ts, giro per giro:
 *
 * - «geofence»: sveglia silenziosa, gpsEntry — non annuncia mai.
 * - «region»: l'ingresso nella portata del beacon — annuncia sulla
 *   transizione e scrive «dentro».
 * - «nativa»: il receiver Android ad app chiusa — il suo annuncio si piega
 *   nello stato al drain del risveglio successivo, PRIMA della mossa.
 * - «uscita»: l'uscita dal geofence GPS — scrive «fuori» e disinnesca.
 * - «uscita_region»: l'uscita dalla region a un evento itinerante (nessun
 *   geofence GPS): scrive «fuori» e basta.
 */

type Trigger = "geofence" | "region" | "nativa" | "uscita" | "uscita_region";

function simulate(
  triggers: Trigger[],
  eventId: string,
): { announced: number; armed: number; pending: boolean } {
  let fenceState: string | null = null;
  let pending = false;
  let announced = 0;
  let armed = 0;
  for (const trigger of triggers) {
    if (trigger === "nativa") {
      // Il receiver annuncia da sé; il drain lo piega nello stato.
      if (shouldAnnounceArrival(fenceState, eventId)) announced++;
      fenceState = eventId;
    }
    if (trigger === "uscita" || trigger === "uscita_region") fenceState = "";
    const announcing = trigger === "region";
    if (announcing && shouldAnnounceArrival(fenceState, eventId)) announced++;
    const move = opticalFallbackMove({
      announcing,
      fenceState,
      eventId,
      collectedNow: 0,
      pendingFallback: pending,
      gpsEntry: trigger === "geofence",
      gpsExit: trigger === "uscita",
    });
    if (move === "arma") {
      pending = true;
      armed++;
    }
    if (move === "disinnesca") pending = false;
    if (announcing) fenceState = eventId;
  }
  return { announced, armed, pending };
}

test("l'arrivo classico: il cerchio arma in silenzio, il beacon annuncia e disinnesca", () => {
  const sim = simulate(["geofence", "region"], "evento-a");
  assert.equal(sim.announced, 1, "un solo annuncio, dal beacon");
  assert.equal(sim.armed, 1, "il paracadute era stato armato all'ingresso");
  assert.equal(sim.pending, false, "e il beacon l'ha disinnescato");
});

test("il beacon muto lascia partire il paracadute", () => {
  // Host in ritardo, Bluetooth spento, beacon guasto: dentro il cerchio,
  // nessun codice. La notifica programmata resta armata — e partirà.
  const sim = simulate(["geofence"], "evento-a");
  assert.equal(sim.announced, 0, "nessuna conferma chiesta a 150 metri");
  assert.equal(sim.pending, true);
});

test("i replay di iOS non moltiplicano il paracadute", () => {
  const sim = simulate(["geofence", "geofence", "geofence"], "evento-a");
  assert.equal(sim.armed, 1);
});

test("passare accanto al locale non produce inviti", () => {
  const sim = simulate(["geofence", "uscita"], "evento-a");
  assert.equal(sim.announced, 0);
  assert.equal(sim.pending, false, "uscito prima del beacon: disinnescato");
});

test("il rientro riarma: un paracadute per ingresso", () => {
  const sim = simulate(["geofence", "uscita", "geofence"], "evento-a");
  assert.equal(sim.armed, 2);
});

test("ad app chiusa annuncia il receiver, e il cerchio tace", () => {
  // Android: la nativa ha già annunciato; il geofence che drena trova lo
  // stato «dentro» e non arma niente. La region rigiocata non riannuncia.
  const sim = simulate(["nativa", "geofence", "region"], "evento-a");
  assert.equal(sim.announced, 1);
  assert.equal(sim.armed, 0);
});

test("in ritardo alla passeggiata sveglia il beacon, non il punto sulla mappa", () => {
  // La region arriva prima del geofence: annuncio subito, mai armato.
  const sim = simulate(["region", "geofence"], "evento-a");
  assert.equal(sim.announced, 1);
  assert.equal(sim.armed, 0);
});

test("all'evento itinerante l'uscita dalla region riarma l'annuncio", () => {
  // Lasci il gruppo a metà passeggiata («l'evento è uscito da te») e lo
  // raggiungi di nuovo: quella è una transizione vera, si riannuncia.
  const sim = simulate(["region", "uscita_region", "region"], "evento-a");
  assert.equal(sim.announced, 2);
});
