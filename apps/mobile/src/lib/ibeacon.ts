/**
 * Lettura del frame iBeacon emesso dal beacon-notaio (firmware/).
 *
 * Il Codice Rotante viaggia nei campi major/minor con una divisione
 * decimale: `codice = major * 10000 + minor`. Il telefono non deriva
 * niente — ascolta e basta: il segreto sta nel beacon, la verifica nel
 * server. La direzione è telefono-ascolta, non beacon-guarda.
 *
 * Modulo puro (nessun import React Native): testabile con `npm test`.
 * Il contratto dei byte è quello scritto in firmware/README.md.
 */

export interface IBeaconFrame {
  /** UUID di prossimità in maiuscolo con trattini. */
  uuid: string;
  major: number;
  minor: number;
  /** Potenza calibrata a 1 m dichiarata dal beacon (dBm). */
  measuredPower: number;
}

const APPLE_COMPANY_ID_LO = 0x4c;
const APPLE_COMPANY_ID_HI = 0x00;
const IBEACON_TYPE = 0x02;
const IBEACON_DATA_LENGTH = 0x15;
/** 2 (company) + 2 (tipo+lunghezza) + 16 (uuid) + 2 + 2 + 1 (potenza). */
export const IBEACON_MANUFACTURER_LENGTH = 25;
/** La potenza calibrata a 1 m dichiarata dal firmware (config.h). */
export const IBEACON_MEASURED_POWER = -59;

/**
 * Interpreta i "manufacturer specific data" di un annuncio BLE.
 * Ritorna null se non è un frame iBeacon: qualunque altro annuncio nel
 * raggio viene semplicemente ignorato.
 */
export function parseIBeaconManufacturerData(
  bytes: Uint8Array,
): IBeaconFrame | null {
  if (bytes.length < IBEACON_MANUFACTURER_LENGTH) return null;
  if (bytes[0] !== APPLE_COMPANY_ID_LO || bytes[1] !== APPLE_COMPANY_ID_HI) {
    return null;
  }
  if (bytes[2] !== IBEACON_TYPE || bytes[3] !== IBEACON_DATA_LENGTH) return null;

  const hex: string[] = [];
  for (let i = 4; i < 20; i++) {
    hex.push(bytes[i].toString(16).padStart(2, "0"));
  }
  const flat = hex.join("").toUpperCase();
  const uuid = [
    flat.slice(0, 8),
    flat.slice(8, 12),
    flat.slice(12, 16),
    flat.slice(16, 20),
    flat.slice(20, 32),
  ].join("-");

  return {
    uuid,
    major: (bytes[20] << 8) | bytes[21],
    minor: (bytes[22] << 8) | bytes[23],
    measuredPower: (bytes[24] << 24) >> 24, // int8
  };
}

/**
 * Il Codice Rotante ricomposto dai campi del frame, o null se questo
 * beacon non ne sta trasmettendo uno valido.
 *
 * major=0 minor=0 è il sentinella del firmware per "orologio non
 * sincronizzato": l'UUID continua ad annunciare (e a svegliare l'app) ma
 * non c'è nessun codice da raccogliere.
 */
export function rotatingCodeFromFrame(frame: {
  major: number;
  minor: number;
}): string | null {
  const { major, minor } = frame;
  if (!Number.isInteger(major) || !Number.isInteger(minor)) return null;
  if (major < 0 || major > 99 || minor < 0 || minor > 9999) return null;
  if (major === 0 && minor === 0) return null;
  return String(major * 10000 + minor).padStart(6, "0");
}

/**
 * Il Codice Rotante ripartito nei campi del frame, inverso di
 * `rotatingCodeFromFrame`. Null se il codice non è nel formato a 6 cifre:
 * il notaio non deve poter mettere in onda un frame che l'attendee poi
 * scarterebbe.
 */
export function splitRotatingCode(
  code: string,
): { major: number; minor: number } | null {
  if (!/^\d{6}$/.test(code)) return null;
  const value = Number(code);
  return { major: Math.floor(value / 10_000), minor: value % 10_000 };
}

/**
 * Costruisce i "manufacturer specific data" di un frame iBeacon: è lo
 * specchio esatto del parser qui sopra e del builder C del firmware
 * (ibeacon_frame.c). Serve alla modalità notaio: quando il beacon è il
 * telefono dell'host, il frame in onda deve essere indistinguibile da
 * quello dell'ESP32 — il roundtrip col parser è testato.
 */
export function buildIBeaconManufacturerData(
  uuid: string,
  major: number,
  minor: number,
  measuredPower: number = IBEACON_MEASURED_POWER,
): Uint8Array {
  const flat = uuid.replace(/-/g, "");
  if (!/^[0-9a-fA-F]{32}$/.test(flat)) {
    throw new RangeError(`UUID di prossimità non valido: ${uuid}`);
  }
  if (!Number.isInteger(major) || major < 0 || major > 0xffff) {
    throw new RangeError(`major fuori dal campo del frame: ${major}`);
  }
  if (!Number.isInteger(minor) || minor < 0 || minor > 0xffff) {
    throw new RangeError(`minor fuori dal campo del frame: ${minor}`);
  }

  const out = new Uint8Array(IBEACON_MANUFACTURER_LENGTH);
  out[0] = APPLE_COMPANY_ID_LO;
  out[1] = APPLE_COMPANY_ID_HI;
  out[2] = IBEACON_TYPE;
  out[3] = IBEACON_DATA_LENGTH;
  for (let i = 0; i < 16; i++) {
    out[4 + i] = parseInt(flat.slice(i * 2, i * 2 + 2), 16);
  }
  out[20] = (major >> 8) & 0xff;
  out[21] = major & 0xff;
  out[22] = (minor >> 8) & 0xff;
  out[23] = minor & 0xff;
  out[24] = measuredPower & 0xff; // int8 in complemento a due
  return out;
}

/** Confronto di UUID tollerante a maiuscole/minuscole e trattini. */
export function sameUuid(a: string, b: string): boolean {
  const normalize = (v: string) => v.replace(/-/g, "").toLowerCase();
  return normalize(a) === normalize(b);
}

const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * ble-plx consegna i manufacturer data in base64. React Native non ha
 * Buffer: decodifica qui, senza dipendenze, così il parsing resta puro
 * e testabile su node.
 */
export function decodeBase64(input: string): Uint8Array {
  const clean = input.replace(/[^A-Za-z0-9+/]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let outIndex = 0;
  let buffer = 0;
  let bits = 0;
  for (const char of clean) {
    const value = BASE64_ALPHABET.indexOf(char);
    if (value < 0) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[outIndex++] = (buffer >> bits) & 0xff;
    }
  }
  return out.subarray(0, outIndex);
}
