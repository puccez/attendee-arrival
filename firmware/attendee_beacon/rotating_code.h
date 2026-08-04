/*
 * Codice Rotante — derivazione portabile in C.
 *
 * Gemello esatto di packages/core/src/rotating-code.ts: stessa funzione per
 * beacon-notaio (emissione) e server (verifica). HMAC-SHA256 sul seme
 * dell'evento, messaggio = indice della finestra di 30 s in decimale ASCII,
 * troncatura dinamica stile TOTP (RFC 4226 §5.3), 6 cifre.
 *
 * Nessuna dipendenza (niente mbedTLS): compila tal quale su ESP32 e su host,
 * cosi' la parita' con il core TypeScript e' testabile senza hardware
 * (vedi firmware/test/).
 */
#ifndef ROTATING_CODE_H
#define ROTATING_CODE_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/** Durata della finestra del Codice Rotante (vedi CONTEXT.md). */
#define ROTATING_CODE_WINDOW_MS 30000LL

/** Cifre decimali del codice. Sta in 20 bit: entra nei campi iBeacon. */
#define ROTATING_CODE_DIGITS 6

/** Indice della finestra che contiene `epoch_ms` (ms da epoch UTC). */
int64_t rotating_window_index(int64_t epoch_ms);

/** Il codice come intero 0..999999. */
uint32_t rotating_code_value(const char *seed, int64_t epoch_ms);

/** Il codice come stringa di 6 cifre; `out` >= 7 byte. */
void rotating_code_string(const char *seed, int64_t epoch_ms, char *out);

/**
 * Divisione decimale del codice nei campi iBeacon: major = le prime 2 cifre,
 * minor = le ultime 4. Scelta voluta: uno scanner BLE generico (nRF Connect)
 * mostra major=12 minor=3456 e tu leggi 123456 senza convertire nulla.
 */
void rotating_code_split(uint32_t value, uint16_t *major, uint16_t *minor);

/** Ricomposizione (usata dai test e dall'app attendee). */
uint32_t rotating_code_join(uint16_t major, uint16_t minor);

/* Primitive esposte per i test. */
void rotating_sha256(const uint8_t *data, size_t len, uint8_t out[32]);
void rotating_hmac_sha256(const uint8_t *key, size_t key_len,
                          const uint8_t *msg, size_t msg_len, uint8_t out[32]);

#ifdef __cplusplus
}
#endif

#endif /* ROTATING_CODE_H */
