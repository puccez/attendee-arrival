import assert from "node:assert/strict";
import test from "node:test";

import {
  opticalPayload,
  opticalVerdict,
  shouldConsiderScan,
  SCAN_REPEAT_AFTER_MS,
} from "../src/lib/optical.ts";

/*
 * Il contratto del canale ottico letto dal telefono: il QR della console è
 * l'unico che diventa un codice, e diventa ESATTAMENTE il codice che si
 * sarebbe digitato a mano. Tutto il resto — inviti, URL, JSON storti — deve
 * cadere in un verdetto che l'interfaccia sa raccontare con garbo, mai in
 * un'eccezione o in un codice malformato messo in coda.
 */

test("il QR della console del proprio evento diventa un codice", () => {
  assert.deepEqual(opticalVerdict(opticalPayload("evento-a", "123456"), "evento-a"), {
    kind: "codice",
    code: "123456",
  });
});

test("lo zero iniziale sopravvive: il codice resta una stringa di sei cifre", () => {
  assert.deepEqual(opticalVerdict(opticalPayload("evento-a", "004201"), "evento-a"), {
    kind: "codice",
    code: "004201",
  });
});

test("il QR di un altro evento si riconosce, e dice quale", () => {
  assert.deepEqual(opticalVerdict(opticalPayload("evento-b", "123456"), "evento-a"), {
    kind: "altro-evento",
    eventId: "evento-b",
  });
});

test("un QR d'invito (un URL) è estraneo, non un errore", () => {
  assert.deepEqual(
    opticalVerdict("https://attendee-arrival-web.vercel.app/attendee/evento-a", "evento-a"),
    { kind: "estraneo" },
  );
});

test("il testo qualunque di un QR da tavolo è estraneo", () => {
  assert.deepEqual(opticalVerdict("WIFI:S:BarMario;P:aperitivo;;", "evento-a"), {
    kind: "estraneo",
  });
});

test("un JSON che non è il nostro payload è estraneo", () => {
  // null, array, oggetto senza campi, campi del tipo sbagliato: la
  // fotocamera li consegna tutti, nessuno deve passare.
  for (const raw of [
    "null",
    "[1,2,3]",
    "{}",
    '{"e":"evento-a"}',
    '{"c":"123456"}',
    '{"e":"","c":"123456"}',
    '{"e":"evento-a","c":123456}',
    '{"e":"evento-a","c":"12345"}',
    '{"e":"evento-a","c":"1234567"}',
    '{"e":"evento-a","c":"abcdef"}',
  ]) {
    assert.deepEqual(opticalVerdict(raw, "evento-a"), { kind: "estraneo" }, raw);
  }
});

/* ------------------------------------------------- il filtro anti-raffica */

test("il primo scan si considera sempre", () => {
  assert.equal(shouldConsiderScan(null, "qualcosa", 1_000), true);
});

test("lo stesso frame ripetuto subito si ignora", () => {
  const last = { data: "qualcosa", at: 1_000 };
  assert.equal(shouldConsiderScan(last, "qualcosa", 1_100), false);
});

test("un QR diverso passa anche subito", () => {
  const last = { data: "qualcosa", at: 1_000 };
  assert.equal(shouldConsiderScan(last, "altro", 1_050), true);
});

test("lo stesso QR ripresentato dopo la pausa si riconsidera", () => {
  const last = { data: "qualcosa", at: 1_000 };
  assert.equal(
    shouldConsiderScan(last, "qualcosa", 1_000 + SCAN_REPEAT_AFTER_MS),
    true,
  );
});
