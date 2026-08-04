/*
 * Parità firmware ↔ core: il C che gira sull'ESP32 deve derivare
 * esattamente gli stessi codici del TypeScript che il server usa per
 * verificarli. Un solo bit di scarto e il canale radio non accredita nulla.
 *
 *   node --test firmware/test/
 *
 * (compila da sé l'oracolo C con gcc; richiede packages/core buildato)
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
]);

/** Passa i casi all'oracolo C in un colpo solo. */
function deriveInC(cases) {
  const input = cases.map(([seed, ms]) => `${seed} ${ms}`).join("\n") + "\n";
  return execFileSync(bin, { input, encoding: "utf8" })
    .trim()
    .split("\n")
    .map((line) => {
      const [code, major, minor] = line.split(" ");
      return { code, major: Number(major), minor: Number(minor) };
    });
}

test("il firmware deriva gli stessi codici del core, su semi e istanti casuali", () => {
  const cases = [];
  for (let i = 0; i < 500; i++) {
    // Semi nel formato dell'API: randomBytes(32).toString('hex') → 64 char.
    const seed = randomBytes(32).toString("hex");
    // Istanti sparsi su ±1 anno attorno a adesso.
    const ms = Date.now() + Math.floor((Math.random() - 0.5) * 63_072_000_000);
    cases.push([seed, ms]);
  }

  const fromC = deriveInC(cases);
  assert.equal(fromC.length, cases.length);

  cases.forEach(([seed, ms], i) => {
    const expected = deriveRotatingCode(seed, new Date(ms));
    assert.equal(
      fromC[i].code,
      expected,
      `seme ${seed} @ ${ms}: firmware ${fromC[i].code} ≠ core ${expected}`,
    );
  });
});

test("i confini di finestra cadono negli stessi punti", () => {
  const seed = randomBytes(32).toString("hex");
  const base = Math.floor(Date.now() / 30_000) * 30_000;
  const offsets = [0, 1, 15_000, 29_998, 29_999, 30_000, 30_001, 59_999, 60_000];
  const cases = offsets.map((o) => [seed, base + o]);

  const fromC = deriveInC(cases);
  cases.forEach(([, ms], i) => {
    assert.equal(fromC[i].code, deriveRotatingCode(seed, new Date(ms)));
  });

  // La finestra cambia davvero: stesso codice dentro, diverso appena fuori.
  assert.equal(fromC[0].code, fromC[4].code, "dentro la stessa finestra");
  assert.notEqual(fromC[4].code, fromC[5].code, "finestra successiva");
});

test("major/minor ricompongono il codice (contratto del frame iBeacon)", () => {
  const cases = [];
  for (let i = 0; i < 200; i++) {
    cases.push([randomBytes(32).toString("hex"), Date.now() + i * 30_000]);
  }

  for (const { code, major, minor } of deriveInC(cases)) {
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
  const codes = new Set(deriveInC(cases).map((r) => r.code));
  assert.ok(codes.size > 90, `attesi codici distinti, trovati ${codes.size}`);
});
