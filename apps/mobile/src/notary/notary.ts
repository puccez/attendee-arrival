import {
  buildIBeaconManufacturerData,
  splitRotatingCode,
} from "../lib/ibeacon";
import { deriveRotatingCode, msUntilNextWindow } from "../lib/rotating-code";

/**
 * La modalità notaio: il telefono dell'host gioca il ruolo del beacon.
 *
 * Il beacon-notaio è un ruolo, non un oggetto — è definito da «custodisce il
 * seme, deriva il Codice Rotante, emette il frame». Qui vive la parte pura
 * di quel ruolo: cosa emettere adesso e quando ruotare, e l'igiene del seme.
 * La radio vera sta nel modulo nativo, la persistenza nel borsellino: questo
 * file non importa niente di React Native ed è inchiodato da `npm test`.
 */

/** L'incarico del notaio: per quale evento emette, con quale seme. */
export interface NotaryCharge {
  eventId: string;
  seed: string;
}

/**
 * L'igiene del seme: un incarico vale solo per l'evento corrente.
 *
 * Il seme scende sul telefono una volta e ci resta finché serve — la rete
 * del locale può morire, l'emissione no. Ma un telefono d'host non deve
 * accumulare segreti di eventi passati: se l'evento è cambiato (o non c'è
 * più), l'incarico è revocato e chi lo legge deve cancellarlo.
 */
export function reconcileCharge(
  stored: NotaryCharge | null,
  currentEventId: string | null,
): NotaryCharge | null {
  if (!stored || !stored.eventId || !stored.seed) return null;
  if (!currentEventId || stored.eventId !== currentEventId) return null;
  return stored;
}

/** Cosa mettere in onda adesso, e per quanto ancora. */
export interface NotaryAnnouncement {
  /** Il Codice Rotante corrente — quello che la console mostra nel QR. */
  code: string;
  major: number;
  minor: number;
  /** Il timer di rotazione: fra quanti ms inizia la prossima finestra. */
  rotateInMs: number;
}

/**
 * Il frame corrente del notaio. Stessa derivazione del firmware, stessa
 * ripartizione decimale su major/minor — un codice di 000000 esce in onda
 * come sentinella «orologio non sincronizzato», identico all'ESP32 (1 caso
 * su un milione, e la finestra dopo passa).
 */
export function notaryAnnouncement(seed: string, at: Date): NotaryAnnouncement {
  const code = deriveRotatingCode(seed, at);
  const { major, minor } = splitRotatingCode(code)!;
  return { code, major, minor, rotateInMs: msUntilNextWindow(at) };
}

/**
 * I manufacturer data che l'annuncio mette in onda (il percorso Android:
 * l'advertiser nativo riceve i byte già pronti; su iOS major/minor bastano,
 * il frame lo compone CoreLocation).
 */
export function notaryManufacturerData(
  uuid: string,
  announcement: NotaryAnnouncement,
): Uint8Array {
  return buildIBeaconManufacturerData(
    uuid,
    announcement.major,
    announcement.minor,
  );
}
