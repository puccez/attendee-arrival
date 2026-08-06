/**
 * Derivazione del Codice Rotante sul telefono del notaio.
 *
 * È la terza implementazione dello stesso contratto — il core TypeScript la
 * fa per il server, il C per l'ESP32, questa per la modalità notaio — ed è
 * duplicata per costruzione: l'app mobile sta fuori dal workspace pnpm e
 * Hermes non ha node:crypto, quindi SHA-256 e HMAC vivono qui, puri. I
 * vettori di parità in test/notary.test.ts sono il contratto che tiene le
 * tre implementazioni incollate: un bit di scarto e il server respinge
 * tutto ciò che il notaio emette.
 *
 * L'app attendee continua a NON derivare niente: ascolta e basta. Questo
 * modulo entra in gioco solo quando il telefono gioca l'altro ruolo.
 */

/** Durata della finestra del Codice Rotante (identica a core e firmware). */
export const CODE_WINDOW_MS = 30_000;

export function windowIndex(at: Date): number {
  return Math.floor(at.getTime() / CODE_WINDOW_MS);
}

/** Quanto manca alla prossima finestra: è il timer di rotazione del notaio. */
export function msUntilNextWindow(at: Date): number {
  const into =
    ((at.getTime() % CODE_WINDOW_MS) + CODE_WINDOW_MS) % CODE_WINDOW_MS;
  return CODE_WINDOW_MS - into;
}

/**
 * Il Codice Rotante dell'evento per la finestra che contiene `at`:
 * HMAC-SHA256(seme, indice di finestra), troncatura dinamica stile TOTP
 * (RFC 4226 §5.3), 6 cifre decimali. Speculare a
 * packages/core/src/rotating-code.ts e firmware/attendee_beacon/rotating_code.c.
 */
export function deriveRotatingCode(seed: string, at: Date): string {
  const digest = hmacSha256(
    asciiBytes(seed),
    asciiBytes(String(windowIndex(at))),
  );
  const offset = digest[31] & 0x0f;
  const value =
    (((digest[offset] & 0x7f) << 24) |
      (digest[offset + 1] << 16) |
      (digest[offset + 2] << 8) |
      digest[offset + 3]) %
    1_000_000;
  return String(value).padStart(6, "0");
}

/* ------------------------------------------------------------ HMAC-SHA256 */

/** Seme e indice di finestra sono ASCII per costruzione (hex e cifre). */
function asciiBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

export function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
  let k = key;
  if (k.length > 64) k = sha256(k);
  const padded = new Uint8Array(64);
  padded.set(k);

  const inner = new Uint8Array(64 + message.length);
  for (let i = 0; i < 64; i++) inner[i] = padded[i] ^ 0x36;
  inner.set(message, 64);
  const innerDigest = sha256(inner);

  const outer = new Uint8Array(64 + 32);
  for (let i = 0; i < 64; i++) outer[i] = padded[i] ^ 0x5c;
  outer.set(innerDigest, 64);
  return sha256(outer);
}

/* ---------------------------------------------------------------- SHA-256 */

// prettier-ignore
const K = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

export function sha256(bytes: Uint8Array): Uint8Array {
  // Padding: 0x80, zeri, lunghezza in bit su 64 bit big-endian.
  const bitLength = bytes.length * 8;
  const padded = new Uint8Array((((bytes.length + 8) >> 6) + 1) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x1_0000_0000));
  view.setUint32(padded.length - 4, bitLength >>> 0);

  const state = Uint32Array.from([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);

  for (let block = 0; block < padded.length; block += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(block + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = state;
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + s1 + ch + K[i] + w[i]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }

    state[0] = (state[0] + a) >>> 0;
    state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0;
    state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0;
    state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0;
    state[7] = (state[7] + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) outView.setUint32(i * 4, state[i]);
  return out;
}
