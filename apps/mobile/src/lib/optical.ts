/**
 * Il canale ottico, lato lettura: cosa fare di un QR inquadrato.
 *
 * Il QR della console (e della modalità notaio) porta `{"e":…,"c":…}` —
 * evento e Codice Rotante, lo stesso payload di
 * apps/web/app/pages/console/[id].vue. Ma la fotocamera non inquadra solo
 * quello: al tavolo girano QR d'invito (un URL), menù, biglietti. Questo
 * modulo decide senza toccare la fotocamera né la rete, così il confine
 * fra «è il nostro» e «è un altro QR» resta inchiodato da `npm test`.
 *
 * Il verdetto non valida il codice — quello lo fa il server, come per il
 * codice digitato a mano: qui si stabilisce solo se vale la pena metterlo
 * nel borsellino.
 */

export const OPTICAL_CODE_PATTERN = /^\d{6}$/;

/** Il payload del QR, come lo compone la console: un oggetto {e, c}. */
export function opticalPayload(eventId: string, code: string): string {
  return JSON.stringify({ e: eventId, c: code });
}

export type OpticalVerdict =
  /** Il QR del NOSTRO evento: il codice prende la stessa strada del codice a mano. */
  | { kind: "codice"; code: string }
  /** Un QR di WeMeet, ma di un altro evento: da dire con garbo, non da raccogliere. */
  | { kind: "altro-evento"; eventId: string }
  /** Qualunque altra cosa (invito, URL, menù): si ignora, con un messaggio. */
  | { kind: "estraneo" };

/**
 * Il verdetto su un QR inquadrato, rispetto all'evento corrente.
 *
 * Severo per costruzione: solo un JSON `{e, c}` con `c` di sei cifre è
 * «nostro». Un `c` numerico invece che stringa, o di lunghezza sbagliata,
 * finisce fra gli estranei — meglio un messaggio in più che un codice
 * malformato in coda.
 */
export function opticalVerdict(
  raw: string,
  currentEventId: string,
): OpticalVerdict {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "estraneo" };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { kind: "estraneo" };
  }
  const { e, c } = parsed as { e?: unknown; c?: unknown };
  if (typeof e !== "string" || e.length === 0) return { kind: "estraneo" };
  if (typeof c !== "string" || !OPTICAL_CODE_PATTERN.test(c)) {
    return { kind: "estraneo" };
  }
  if (e !== currentEventId) return { kind: "altro-evento", eventId: e };
  return { kind: "codice", code: c };
}

/**
 * Il filtro anti-raffica: la fotocamera consegna lo stesso QR decine di
 * volte al secondo finché resta nell'inquadratura. Un payload va
 * riconsiderato solo se è diverso dall'ultimo, o se dall'ultima volta è
 * passato abbastanza silenzio — così il messaggio d'errore non lampeggia
 * a ogni frame, e togliere e rimettere il QR davanti alla lente funziona.
 */
export const SCAN_REPEAT_AFTER_MS = 2_000;

export function shouldConsiderScan(
  last: { data: string; at: number } | null,
  data: string,
  at: number,
): boolean {
  if (!last) return true;
  if (last.data !== data) return true;
  return at - last.at >= SCAN_REPEAT_AFTER_MS;
}
