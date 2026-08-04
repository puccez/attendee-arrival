#include "rotating_code.h"

#include <string.h>

/* ---------------------------------------------------------------- SHA-256 */

typedef struct {
  uint32_t state[8];
  uint64_t bit_len;
  uint8_t buf[64];
  size_t buf_len;
} sha256_ctx;

static const uint32_t SHA256_K[64] = {
    0x428a2f98u, 0x71374491u, 0xb5c0fbcfu, 0xe9b5dba5u, 0x3956c25bu,
    0x59f111f1u, 0x923f82a4u, 0xab1c5ed5u, 0xd807aa98u, 0x12835b01u,
    0x243185beu, 0x550c7dc3u, 0x72be5d74u, 0x80deb1feu, 0x9bdc06a7u,
    0xc19bf174u, 0xe49b69c1u, 0xefbe4786u, 0x0fc19dc6u, 0x240ca1ccu,
    0x2de92c6fu, 0x4a7484aau, 0x5cb0a9dcu, 0x76f988dau, 0x983e5152u,
    0xa831c66du, 0xb00327c8u, 0xbf597fc7u, 0xc6e00bf3u, 0xd5a79147u,
    0x06ca6351u, 0x14292967u, 0x27b70a85u, 0x2e1b2138u, 0x4d2c6dfcu,
    0x53380d13u, 0x650a7354u, 0x766a0abbu, 0x81c2c92eu, 0x92722c85u,
    0xa2bfe8a1u, 0xa81a664bu, 0xc24b8b70u, 0xc76c51a3u, 0xd192e819u,
    0xd6990624u, 0xf40e3585u, 0x106aa070u, 0x19a4c116u, 0x1e376c08u,
    0x2748774cu, 0x34b0bcb5u, 0x391c0cb3u, 0x4ed8aa4au, 0x5b9cca4fu,
    0x682e6ff3u, 0x748f82eeu, 0x78a5636fu, 0x84c87814u, 0x8cc70208u,
    0x90befffau, 0xa4506cebu, 0xbef9a3f7u, 0xc67178f2u};

static uint32_t rotr32(uint32_t x, unsigned n) {
  return (x >> n) | (x << (32u - n));
}

static void sha256_compress(sha256_ctx *ctx, const uint8_t block[64]) {
  uint32_t w[64];
  for (unsigned i = 0; i < 16; i++) {
    w[i] = ((uint32_t)block[i * 4] << 24) | ((uint32_t)block[i * 4 + 1] << 16) |
           ((uint32_t)block[i * 4 + 2] << 8) | (uint32_t)block[i * 4 + 3];
  }
  for (unsigned i = 16; i < 64; i++) {
    uint32_t s0 = rotr32(w[i - 15], 7) ^ rotr32(w[i - 15], 18) ^ (w[i - 15] >> 3);
    uint32_t s1 = rotr32(w[i - 2], 17) ^ rotr32(w[i - 2], 19) ^ (w[i - 2] >> 10);
    w[i] = w[i - 16] + s0 + w[i - 7] + s1;
  }

  uint32_t a = ctx->state[0], b = ctx->state[1], c = ctx->state[2],
           d = ctx->state[3], e = ctx->state[4], f = ctx->state[5],
           g = ctx->state[6], h = ctx->state[7];

  for (unsigned i = 0; i < 64; i++) {
    uint32_t s1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
    uint32_t ch = (e & f) ^ (~e & g);
    uint32_t t1 = h + s1 + ch + SHA256_K[i] + w[i];
    uint32_t s0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
    uint32_t maj = (a & b) ^ (a & c) ^ (b & c);
    uint32_t t2 = s0 + maj;
    h = g;
    g = f;
    f = e;
    e = d + t1;
    d = c;
    c = b;
    b = a;
    a = t1 + t2;
  }

  ctx->state[0] += a;
  ctx->state[1] += b;
  ctx->state[2] += c;
  ctx->state[3] += d;
  ctx->state[4] += e;
  ctx->state[5] += f;
  ctx->state[6] += g;
  ctx->state[7] += h;
}

static void sha256_init(sha256_ctx *ctx) {
  ctx->state[0] = 0x6a09e667u;
  ctx->state[1] = 0xbb67ae85u;
  ctx->state[2] = 0x3c6ef372u;
  ctx->state[3] = 0xa54ff53au;
  ctx->state[4] = 0x510e527fu;
  ctx->state[5] = 0x9b05688cu;
  ctx->state[6] = 0x1f83d9abu;
  ctx->state[7] = 0x5be0cd19u;
  ctx->bit_len = 0;
  ctx->buf_len = 0;
}

static void sha256_update(sha256_ctx *ctx, const uint8_t *data, size_t len) {
  ctx->bit_len += (uint64_t)len * 8u;
  while (len > 0) {
    size_t room = 64u - ctx->buf_len;
    size_t take = len < room ? len : room;
    memcpy(ctx->buf + ctx->buf_len, data, take);
    ctx->buf_len += take;
    data += take;
    len -= take;
    if (ctx->buf_len == 64u) {
      sha256_compress(ctx, ctx->buf);
      ctx->buf_len = 0;
    }
  }
}

static void sha256_final(sha256_ctx *ctx, uint8_t out[32]) {
  uint64_t bit_len = ctx->bit_len;
  size_t i = ctx->buf_len;

  ctx->buf[i++] = 0x80u;
  if (i > 56u) {
    while (i < 64u) ctx->buf[i++] = 0x00u;
    sha256_compress(ctx, ctx->buf);
    i = 0;
  }
  while (i < 56u) ctx->buf[i++] = 0x00u;
  for (unsigned j = 0; j < 8u; j++) {
    ctx->buf[56u + j] = (uint8_t)(bit_len >> (8u * (7u - j)));
  }
  sha256_compress(ctx, ctx->buf);

  for (unsigned s = 0; s < 8u; s++) {
    out[s * 4] = (uint8_t)(ctx->state[s] >> 24);
    out[s * 4 + 1] = (uint8_t)(ctx->state[s] >> 16);
    out[s * 4 + 2] = (uint8_t)(ctx->state[s] >> 8);
    out[s * 4 + 3] = (uint8_t)ctx->state[s];
  }
}

void rotating_sha256(const uint8_t *data, size_t len, uint8_t out[32]) {
  sha256_ctx ctx;
  sha256_init(&ctx);
  sha256_update(&ctx, data, len);
  sha256_final(&ctx, out);
}

/* ----------------------------------------------------------- HMAC-SHA256 */

void rotating_hmac_sha256(const uint8_t *key, size_t key_len,
                          const uint8_t *msg, size_t msg_len, uint8_t out[32]) {
  uint8_t k[64];
  memset(k, 0, sizeof k);
  if (key_len > 64u) {
    rotating_sha256(key, key_len, k);
  } else {
    memcpy(k, key, key_len);
  }

  uint8_t pad[64];
  uint8_t inner[32];
  sha256_ctx ctx;

  for (unsigned i = 0; i < 64u; i++) pad[i] = k[i] ^ 0x36u;
  sha256_init(&ctx);
  sha256_update(&ctx, pad, 64);
  sha256_update(&ctx, msg, msg_len);
  sha256_final(&ctx, inner);

  for (unsigned i = 0; i < 64u; i++) pad[i] = k[i] ^ 0x5cu;
  sha256_init(&ctx);
  sha256_update(&ctx, pad, 64);
  sha256_update(&ctx, inner, 32);
  sha256_final(&ctx, out);
}

/* -------------------------------------------------------- Codice Rotante */

int64_t rotating_window_index(int64_t epoch_ms) {
  /* Divisione con arrotondamento verso il basso, come Math.floor in JS. */
  int64_t q = epoch_ms / ROTATING_CODE_WINDOW_MS;
  if (epoch_ms % ROTATING_CODE_WINDOW_MS != 0 && epoch_ms < 0) q -= 1;
  return q;
}

/** Rappresentazione decimale ASCII, come String(n) in JS. Ritorna la lunghezza. */
static size_t i64_to_decimal(int64_t n, char *out) {
  char tmp[24];
  size_t len = 0;
  int negative = n < 0;
  uint64_t u = negative ? (uint64_t)(-(n + 1)) + 1u : (uint64_t)n;
  do {
    tmp[len++] = (char)('0' + (u % 10u));
    u /= 10u;
  } while (u > 0u);
  size_t pos = 0;
  if (negative) out[pos++] = '-';
  while (len > 0) out[pos++] = tmp[--len];
  out[pos] = '\0';
  return pos;
}

uint32_t rotating_code_value(const char *seed, int64_t epoch_ms) {
  char message[24];
  size_t message_len = i64_to_decimal(rotating_window_index(epoch_ms), message);

  uint8_t digest[32];
  rotating_hmac_sha256((const uint8_t *)seed, strlen(seed),
                       (const uint8_t *)message, message_len, digest);

  /* Troncatura dinamica RFC 4226 §5.3 — identica al core TypeScript. */
  unsigned offset = digest[31] & 0x0fu;
  uint32_t value = ((uint32_t)(digest[offset] & 0x7fu) << 24) |
                   ((uint32_t)digest[offset + 1] << 16) |
                   ((uint32_t)digest[offset + 2] << 8) |
                   (uint32_t)digest[offset + 3];
  return value % 1000000u;
}

void rotating_code_string(const char *seed, int64_t epoch_ms, char *out) {
  uint32_t value = rotating_code_value(seed, epoch_ms);
  for (int i = ROTATING_CODE_DIGITS - 1; i >= 0; i--) {
    out[i] = (char)('0' + (value % 10u));
    value /= 10u;
  }
  out[ROTATING_CODE_DIGITS] = '\0';
}

void rotating_code_split(uint32_t value, uint16_t *major, uint16_t *minor) {
  *major = (uint16_t)(value / 10000u);
  *minor = (uint16_t)(value % 10000u);
}

uint32_t rotating_code_join(uint16_t major, uint16_t minor) {
  return (uint32_t)major * 10000u + (uint32_t)minor;
}
