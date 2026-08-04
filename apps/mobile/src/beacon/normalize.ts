import type { NativeSighting } from "../../modules/wemeet-beacon";
import {
  decodeBase64,
  parseIBeaconManufacturerData,
  rotatingCodeFromFrame,
  sameUuid,
} from "../lib/ibeacon";

/**
 * Un avvistamento normalizzato: quello che il telefono ha davvero sentito.
 *
 * Modulo puro (i tipi nativi sono importati solo come tipi): testabile con
 * `npm test`, senza device.
 */
export interface Sighting {
  /** Il Codice Rotante letto dal frame, o null se non c'era (vedi sotto). */
  code: string | null;
  /** Indicatore di distanza. Contesto per la UI, mai una prova. */
  rssi: number | null;
  at: Date;
}

/**
 * Le due piattaforme raccontano lo stesso frame in modi diversi:
 *
 * - **Android** consegna i manufacturer data grezzi: si interpretano con il
 *   parser condiviso, quello testato contro il firmware.
 * - **iOS** passa da CoreLocation, che dà major/minor già estratti (i byte
 *   grezzi non esistono: il sistema non li espone).
 *
 * Ritorna null se l'avvistamento non riguarda il nostro beacon. `code`
 * null significa "beacon sentito, nessun codice da raccogliere": è il caso
 * del firmware con l'orologio non sincronizzato (major=0 minor=0) — la
 * prossimità c'è, la prova no.
 */
export function normalizeSighting(
  raw: NativeSighting,
  expectedUuid: string,
): Sighting | null {
  const at = new Date(typeof raw.at === "number" ? raw.at : Date.now());
  const rssi = typeof raw.rssi === "number" ? raw.rssi : null;

  if (typeof raw.manufacturerData === "string" && raw.manufacturerData) {
    const frame = parseIBeaconManufacturerData(decodeBase64(raw.manufacturerData));
    if (!frame) return null;
    if (!sameUuid(frame.uuid, expectedUuid)) return null;
    return { code: rotatingCodeFromFrame(frame), rssi, at };
  }

  if (typeof raw.major === "number" && typeof raw.minor === "number") {
    if (raw.uuid && !sameUuid(raw.uuid, expectedUuid)) return null;
    return {
      code: rotatingCodeFromFrame({ major: raw.major, minor: raw.minor }),
      rssi,
      at,
    };
  }

  return null;
}

/**
 * Dallo stream di avvistamenti ai codici da mettere nel borsellino, senza
 * ripetizioni: il beacon riemette lo stesso codice per tutti i 30 s della
 * finestra e non ha senso accumularlo trenta volte.
 */
export function distinctCodes(sightings: Sighting[]): string[] {
  const seen = new Set<string>();
  for (const sighting of sightings) {
    if (sighting.code) seen.add(sighting.code);
  }
  return [...seen];
}
