/*
 * Parità fra le tre implementazioni del Codice Rotante:
 *
 *   firmware (C)          lo emette nel frame iBeacon
 *   app attendee (TS)     lo legge dal frame
 *   core (TS)             il server lo verifica
 *
 * Un bit di scarto fra le tre e il canale radio non accredita niente — ed è
 * l'unico modo di accorgersene prima di essere al venue con l'hardware in
 * mano.
 *
 *   make -C firmware test
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { deriveRotatingCode } from "../../packages/core/dist/index.js";
import {
  parseIBeaconManufacturerData,
  rotatingCodeFromFrame,
  sameUuid,
} from "../../apps/mobile/src/lib/ibeacon.ts";

const BEACON_UUID = "B6C60396-4B64-44D6-84E7-54909270550C";

const here = fileURLToPath(new URL(".", import.meta.url));
const bin = join(mkdtempSync(join(tmpdir(), "rotating-parity-")), "parity");

execFileSync("gcc", [
  "-std=c99",
  "-Wall",
  "-Wextra",
  "-Werror",
  "-O2",
  "-o",
  bin,
  join(here, "parity_main.c"),
  join(here, "..", "attendee_beacon", "rotating_code.c"),
  join(here, "..", "attendee_beacon", "ibeacon_frame.c"),
]);

/** Passa i casi all'oracolo C — lo stesso codice che gira sull'ESP32. */
function emitFromFirmware(cases) {
  const input = cases.map(([seed, ms]) => `${seed} ${ms}`).join("\n") + "\n";
  return execFileSync(bin, { input, encoding: "utf8" })
    .trim()
    .split("\n")
    .map((line) => {
      const [code, major, minor, frameHex] = line.split(" ");
      return {
        code,
        major: Number(major),
        minor: Number(minor),
        frame: Uint8Array.from(
          frameHex.match(/../g).map((b) => parseInt(b, 16)),
        ),
      };
    });
}

function randomCases(count) {
  const cases = [];
  for (let i = 0; i < count; i++) {
    // Semi nel formato dell'API: randomBytes(32).toString('hex') → 64 char.
    const seed = randomBytes(32).toString("hex");
    // Istanti sparsi su ±1 anno attorno a adesso.
    const ms = Date.now() + Math.floor((Math.random() - 0.5) * 63_072_000_000);
    cases.push([seed, ms]);
  }
  return cases;
}

test("il firmware deriva gli stessi codici del core, su semi e istanti casuali", () => {
  const cases = randomCases(500);
  const emitted = emitFromFirmware(cases);
  assert.equal(emitted.length, cases.length);

  cases.forEach(([seed, ms], i) => {
    const expected = deriveRotatingCode(seed, new Date(ms));
    assert.equal(
      emitted[i].code,
      expected,
      `seme ${seed} @ ${ms}: firmware ${emitted[i].code} ≠ core ${expected}`,
    );
  });
});

test("l'app legge dal frame in onda esattamente il codice che il server verifica", () => {
  const cases = randomCases(300);
  const emitted = emitFromFirmware(cases);

  cases.forEach(([seed, ms], i) => {
    const frame = parseIBeaconManufacturerData(emitted[i].frame);
    assert.ok(frame, "il frame dell'ESP32 deve essere riconosciuto come iBeacon");
    assert.ok(
      sameUuid(frame.uuid, BEACON_UUID),
      `UUID letto ${frame.uuid} ≠ ${BEACON_UUID}`,
    );
    assert.equal(frame.measuredPower, -59);

    const heard = rotatingCodeFromFrame(frame);
    const expected = deriveRotatingCode(seed, new Date(ms));
    // …tranne il sentinella "orologio non sincronizzato" (1 caso su un milione).
    if (expected === "000000") {
      assert.equal(heard, null);
    } else {
      assert.equal(heard, expected, `app ${heard} ≠ core ${expected}`);
    }
  });
});

test("i confini di finestra cadono negli stessi punti", () => {
  const seed = randomBytes(32).toString("hex");
  const base = Math.floor(Date.now() / 30_000) * 30_000;
  const offsets = [0, 1, 15_000, 29_998, 29_999, 30_000, 30_001, 59_999, 60_000];
  const cases = offsets.map((o) => [seed, base + o]);

  const emitted = emitFromFirmware(cases);
  cases.forEach(([, ms], i) => {
    assert.equal(emitted[i].code, deriveRotatingCode(seed, new Date(ms)));
  });

  // La finestra cambia davvero: stesso codice dentro, diverso appena fuori.
  assert.equal(emitted[0].code, emitted[4].code, "dentro la stessa finestra");
  assert.notEqual(emitted[4].code, emitted[5].code, "finestra successiva");
});

test("major/minor ricompongono il codice (contratto del frame iBeacon)", () => {
  for (const { code, major, minor } of emitFromFirmware(randomCases(200))) {
    assert.ok(major <= 99, `major ${major} deve stare in 2 cifre`);
    assert.ok(minor <= 9999, `minor ${minor} deve stare in 4 cifre`);
    assert.equal(
      String(major * 10_000 + minor).padStart(6, "0"),
      code,
      "major*10000+minor deve ridare il codice",
    );
  }
});

test("semi diversi non collidono sulla stessa finestra", () => {
  const ms = Date.now();
  const cases = Array.from({ length: 100 }, () => [
    randomBytes(32).toString("hex"),
    ms,
  ]);
  const codes = new Set(emitFromFirmware(cases).map((r) => r.code));
  assert.ok(codes.size > 90, `attesi codici distinti, trovati ${codes.size}`);
});
