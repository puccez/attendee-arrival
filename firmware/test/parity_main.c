/*
 * Oracolo host per il test di parità: legge righe "<seme> <epoch_ms>" da
 * stdin e stampa "<codice> <major> <minor> <frame_hex>" — lo stesso identico
 * codice C che gira sull'ESP32, frame iBeacon compreso.
 *
 * Il test node lo confronta con deriveRotatingCode() di
 * @attendee-arrival/core (con cui il server verifica) e dà il frame in pasto
 * al parser dell'app attendee: se una delle tre implementazioni divergesse,
 * il canale radio non accrediterebbe niente.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "../attendee_beacon/ibeacon_frame.h"
#include "../attendee_beacon/rotating_code.h"

/* Lo stesso UUID di config.h e di apps/mobile: l'identità fissa del beacon. */
static const uint8_t DEMO_UUID[16] = {0xB6, 0xC6, 0x03, 0x96, 0x4B, 0x64,
                                      0x44, 0xD6, 0x84, 0xE7, 0x54, 0x90,
                                      0x92, 0x70, 0x55, 0x0C};

int main(void) {
  char line[512];
  while (fgets(line, sizeof line, stdin)) {
    char *space = strchr(line, ' ');
    if (!space) continue;
    *space = '\0';
    long long epoch_ms = atoll(space + 1);

    char code[ROTATING_CODE_DIGITS + 1];
    rotating_code_string(line, (int64_t)epoch_ms, code);

    uint16_t major = 0, minor = 0;
    rotating_code_split(rotating_code_value(line, (int64_t)epoch_ms), &major,
                        &minor);

    uint8_t frame[IBEACON_MANUFACTURER_LEN];
    ibeacon_build_manufacturer_data(DEMO_UUID, major, minor, -59, frame);

    printf("%s %u %u ", code, (unsigned)major, (unsigned)minor);
    for (size_t i = 0; i < IBEACON_MANUFACTURER_LEN; i++) {
      printf("%02x", frame[i]);
    }
    printf("\n");
    fflush(stdout);
  }
  return 0;
}
