import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeBase64,
  parseIBeaconManufacturerData,
  rotatingCodeFromFrame,
  sameUuid,
} from "../src/lib/ibeacon.ts";
import { normalizeSighting } from "../src/beacon/normalize.ts";

const UUID = "B6C60396-4B64-44D6-84E7-54909270550C";

/** Compone un frame come lo compone il firmware (ibeacon_frame.c). */
function frameFor(code: string, uuid = UUID): Uint8Array {
  const value = Number(code);
  const major = Math.floor(value / 10000);
  const minor = value % 10000;
  const uuidBytes = uuid
    .replace(/-/g, "")
    .match(/../g)!
    .map((byte) => parseInt(byte, 16));

  return Uint8Array.from([
    0x4c, 0x00, 0x02, 0x15,
    ...uuidBytes,
    (major >> 8) & 0xff, major & 0xff,
    (minor >> 8) & 0xff, minor & 0xff,
    0xc5, // -59 dBm
  ]);
}

function toBase64(bytes: Uint8Array): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const chunk = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const size = bytes.length - i;
    out += alphabet[(chunk >> 18) & 63] + alphabet[(chunk >> 12) & 63];
    out += size > 1 ? alphabet[(chunk >> 6) & 63] : "=";
    out += size > 2 ? alphabet[chunk & 63] : "=";
  }
  return out;
}

test("legge il Codice Rotante dal frame del beacon", () => {
  for (const code of ["123456", "000001", "999999", "004200", "010000"]) {
    const frame = parseIBeaconManufacturerData(frameFor(code));
    assert.ok(frame, `frame per ${code}`);
    assert.ok(sameUuid(frame.uuid, UUID));
    assert.equal(frame.measuredPower, -59);
    assert.equal(rotatingCodeFromFrame(frame), code);
  }
});

test("ignora gli annunci che non sono iBeacon", () => {
  assert.equal(parseIBeaconManufacturerData(new Uint8Array([0x4c, 0x00])), null);
  assert.equal(
    parseIBeaconManufacturerData(Uint8Array.from({ length: 25 }, () => 0x01)),
    null,
    "company id di un altro produttore",
  );
  const wrongType = frameFor("123456");
  wrongType[2] = 0x03;
  assert.equal(parseIBeaconManufacturerData(wrongType), null);
});

test("major=0 minor=0 è 'orologio non sincronizzato', non un codice", () => {
  const frame = parseIBeaconManufacturerData(frameFor("000000"))!;
  assert.equal(frame.major, 0);
  assert.equal(frame.minor, 0);
  assert.equal(
    rotatingCodeFromFrame(frame),
    null,
    "la prossimità c'è, la prova no",
  );
});

test("scarta i codici fuori dal formato del frame", () => {
  assert.equal(rotatingCodeFromFrame({ major: 100, minor: 0 }), null);
  assert.equal(rotatingCodeFromFrame({ major: 0, minor: 10000 }), null);
  assert.equal(rotatingCodeFromFrame({ major: -1, minor: 5 }), null);
});

test("base64 dei manufacturer data: decodifica ciò che Android manda", () => {
  const frame = frameFor("654321");
  assert.deepEqual([...decodeBase64(toBase64(frame))], [...frame]);
});

test("normalizza gli avvistamenti Android (byte grezzi) e iOS (major/minor)", () => {
  const at = Date.now();

  const android = normalizeSighting(
    { manufacturerData: toBase64(frameFor("246813")), rssi: -62, at },
    UUID,
  );
  assert.equal(android?.code, "246813");
  assert.equal(android?.rssi, -62);

  const ios = normalizeSighting({ uuid: UUID, major: 24, minor: 6813, rssi: -70, at }, UUID);
  assert.equal(ios?.code, "246813");

  assert.equal(
    android?.code,
    ios?.code,
    "le due piattaforme devono sentire lo stesso codice",
  );
});

test("un beacon di un altro UUID non riguarda questo evento", () => {
  const other = "00000000-0000-0000-0000-000000000000";
  assert.equal(
    normalizeSighting({ manufacturerData: toBase64(frameFor("123456", other)) }, UUID),
    null,
  );
  assert.equal(normalizeSighting({ uuid: other, major: 12, minor: 3456 }, UUID), null);
});
