import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import test from "node:test";

import {
  buildIBeaconManufacturerData,
  parseIBeaconManufacturerData,
  rotatingCodeFromFrame,
  sameUuid,
  splitRotatingCode,
} from "../src/lib/ibeacon.ts";
import {
  CODE_WINDOW_MS,
  deriveRotatingCode,
  msUntilNextWindow,
} from "../src/lib/rotating-code.ts";
import {
  notaryAnnouncement,
  notaryManufacturerData,
  reconcileCharge,
} from "../src/notary/notary.ts";

const UUID = "B6C60396-4B64-44D6-84E7-54909270550C";

/**
 * La modalità notaio regge su una promessa sola: il telefono dell'host
 * emette esattamente ciò che l'ESP32 emetterebbe e il server verificherebbe.
 * Questo file la inchioda alle due estremità — derivazione (vettori di
 * parità, gli stessi confini di finestra di firmware/test) e frame
 * (roundtrip col parser dell'attendee).
 */

/* ------------------------------------------------------- derivazione */

// Vettori fissi, generati dalla derivazione del core (packages/core).
// Se uno di questi cambia, il notaio sta emettendo codici che il server
// respinge: non aggiornare i valori senza aggiornare TUTTE le implementazioni.
const PARITY_VECTORS: [seed: string, ms: number, code: string][] = [
  ["e2b1c1d94f0a76c3b7a95dd0cf2e2a1108d64b0f5a3c9e7d1b8f0a2c4e6d8b1a", 1754438400000, "146357"],
  ["00a1b2c3d4e5f60718293a4b5c6d7e8f9fa0b1c2d3e4f5061728394a5b6c7d8e", 1754438429999, "380317"],
  ["00a1b2c3d4e5f60718293a4b5c6d7e8f9fa0b1c2d3e4f5061728394a5b6c7d8e", 1754438430000, "660216"],
  ["ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100", 1699999999999, "209841"],
  ["6977b74f239c479c97d2ba6b9739ebb3aabbccddeeff00112233445566778899", 1800000000123, "353128"],
];

test("la derivazione del notaio combacia con i vettori di parità del core", () => {
  for (const [seed, ms, code] of PARITY_VECTORS) {
    assert.equal(
      deriveRotatingCode(seed, new Date(ms)),
      code,
      `seme ${seed.slice(0, 8)}… @ ${ms}`,
    );
  }
});

/** L'oracolo: la stessa derivazione del core, su node:crypto. */
function oracle(seed: string, ms: number): string {
  const digest = createHmac("sha256", seed)
    .update(String(Math.floor(ms / CODE_WINDOW_MS)))
    .digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const value =
    (((digest[offset]! & 0x7f) << 24) |
      (digest[offset + 1]! << 16) |
      (digest[offset + 2]! << 8) |
      digest[offset + 3]!) %
    1_000_000;
  return String(value).padStart(6, "0");
}

test("la derivazione pura regge su semi e istanti casuali (contro node:crypto)", () => {
  for (let i = 0; i < 300; i++) {
    // Semi nel formato dell'API: randomBytes(32).toString('hex') → 64 char.
    const seed = randomBytes(32).toString("hex");
    const ms = Date.now() + Math.floor((Math.random() - 0.5) * 63_072_000_000);
    assert.equal(
      deriveRotatingCode(seed, new Date(ms)),
      oracle(seed, ms),
      `seme ${seed} @ ${ms}`,
    );
  }
});

test("i confini di finestra cadono negli stessi punti del firmware", () => {
  // Gli stessi offset di firmware/test/parity.test.mjs.
  const seed = randomBytes(32).toString("hex");
  const base = Math.floor(Date.now() / CODE_WINDOW_MS) * CODE_WINDOW_MS;
  const offsets = [0, 1, 15_000, 29_998, 29_999, 30_000, 30_001, 59_999, 60_000];
  for (const offset of offsets) {
    const ms = base + offset;
    assert.equal(deriveRotatingCode(seed, new Date(ms)), oracle(seed, ms));
  }

  const inWindow = deriveRotatingCode(seed, new Date(base));
  assert.equal(deriveRotatingCode(seed, new Date(base + 29_999)), inWindow);
  assert.notEqual(deriveRotatingCode(seed, new Date(base + 30_000)), inWindow);
});

/* ------------------------------------------------------------- frame */

test("il frame del notaio è indistinguibile da quello dell'ESP32: roundtrip col parser", () => {
  for (const code of ["146357", "000001", "999999", "004200", "010000"]) {
    const { major, minor } = splitRotatingCode(code)!;
    const bytes = buildIBeaconManufacturerData(UUID, major, minor);

    const frame = parseIBeaconManufacturerData(bytes);
    assert.ok(frame, `il parser dell'attendee deve riconoscere ${code}`);
    assert.ok(sameUuid(frame.uuid, UUID));
    assert.equal(frame.measuredPower, -59, "stessa potenza dichiarata del firmware");
    assert.equal(rotatingCodeFromFrame(frame), code);
  }
});

test("il costruttore rifiuta ciò che il parser scarterebbe", () => {
  assert.equal(splitRotatingCode("12345"), null, "5 cifre");
  assert.equal(splitRotatingCode("1234567"), null, "7 cifre");
  assert.equal(splitRotatingCode("12a456"), null, "non decimale");
  assert.throws(() => buildIBeaconManufacturerData("non-un-uuid", 1, 2));
  assert.throws(() => buildIBeaconManufacturerData(UUID, -1, 0));
  assert.throws(() => buildIBeaconManufacturerData(UUID, 0, 65_536));
});

/* ---------------------------------------------------------- annuncio */

test("l'annuncio del notaio: codice della finestra, campi del frame, timer di rotazione", () => {
  const [seed, ms, code] = PARITY_VECTORS[0];
  const announcement = notaryAnnouncement(seed, new Date(ms));

  assert.equal(announcement.code, code);
  assert.equal(
    String(announcement.major * 10_000 + announcement.minor).padStart(6, "0"),
    code,
  );
  // ms è l'inizio esatto di una finestra: la rotazione è fra 30 s.
  assert.equal(announcement.rotateInMs, CODE_WINDOW_MS);

  const lastInstant = notaryAnnouncement(seed, new Date(ms + 29_999));
  assert.equal(lastInstant.code, code, "stessa finestra, stesso codice");
  assert.equal(lastInstant.rotateInMs, 1, "la finestra sta per girare");
});

test("l'annuncio messo in onda torna identico dal parser dell'attendee", () => {
  const seed = randomBytes(32).toString("hex");
  const announcement = notaryAnnouncement(seed, new Date());
  const frame = parseIBeaconManufacturerData(
    notaryManufacturerData(UUID, announcement),
  );
  assert.ok(frame);
  // Il sentinella 000000 (1 su un milione) non è un codice nemmeno qui.
  assert.equal(
    rotatingCodeFromFrame(frame),
    announcement.code === "000000" ? null : announcement.code,
  );
});

test("msUntilNextWindow è il complemento esatto dentro la finestra", () => {
  const base = 1754438400000; // inizio finestra
  assert.equal(msUntilNextWindow(new Date(base)), CODE_WINDOW_MS);
  assert.equal(msUntilNextWindow(new Date(base + 1)), CODE_WINDOW_MS - 1);
  assert.equal(msUntilNextWindow(new Date(base + 29_999)), 1);
});

/* ---------------------------------------------- igiene dell'incarico */

test("l'incarico vale solo per l'evento corrente", () => {
  const charge = { eventId: "evento-a", seed: "s".repeat(64) };
  assert.deepEqual(reconcileCharge(charge, "evento-a"), charge);
});

test("cambiare evento revoca l'incarico: il seme vecchio va cancellato", () => {
  const charge = { eventId: "evento-a", seed: "s".repeat(64) };
  assert.equal(reconcileCharge(charge, "evento-b"), null);
  assert.equal(reconcileCharge(charge, null), null, "nessun evento attivo");
  assert.equal(reconcileCharge(charge, ""), null);
});

test("un incarico vuoto o monco non è un incarico", () => {
  assert.equal(reconcileCharge(null, "evento-a"), null);
  assert.equal(
    reconcileCharge({ eventId: "evento-a", seed: "" }, "evento-a"),
    null,
    "senza seme non si emette",
  );
  assert.equal(reconcileCharge({ eventId: "", seed: "x" }, ""), null);
});
