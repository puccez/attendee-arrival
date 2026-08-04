import { createHmac } from "node:crypto";

/** Durata della finestra del Codice Rotante (vedi CONTEXT.md). */
export const CODE_WINDOW_MS = 30_000;

export function windowIndex(at: Date): number {
  return Math.floor(at.getTime() / CODE_WINDOW_MS);
}

/**
 * Deriva il Codice Rotante di un evento per la finestra che contiene `at`.
 * Stessa funzione per beacon-notaio (emissione) e server (verifica):
 * 6 cifre decimali, troncatura dinamica stile TOTP (RFC 4226 §5.3) —
 * compatta abbastanza da stare nei campi major/minor di un frame iBeacon.
 */
export function deriveRotatingCode(seed: string, at: Date): string {
  const digest = createHmac("sha256", seed)
    .update(String(windowIndex(at)))
    .digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const value =
    (((digest[offset]! & 0x7f) << 24) |
      (digest[offset + 1]! << 16) |
      (digest[offset + 2]! << 8) |
      digest[offset + 3]!) %
    1_000_000;
  return value.toString().padStart(6, "0");
}
