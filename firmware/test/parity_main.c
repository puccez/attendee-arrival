/*
 * Oracolo host per il test di parità: legge righe "<seme> <epoch_ms>" da
 * stdin e stampa "<codice> <major> <minor>" — lo stesso identico codice C
 * che gira sull'ESP32. Il test node lo confronta con deriveRotatingCode()
 * di @attendee-arrival/core: se divergono, il beacon emette codici che il
 * server respinge.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "../attendee_beacon/rotating_code.h"

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

    printf("%s %u %u\n", code, (unsigned)major, (unsigned)minor);
    fflush(stdout);
  }
  return 0;
}
