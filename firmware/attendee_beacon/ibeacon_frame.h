/*
 * Frame iBeacon — la forma esatta dei byte che escono in onda.
 *
 * Sta in un file suo (e non nello sketch) perché è un contratto fra tre
 * implementazioni: il firmware lo scrive, l'app attendee lo legge
 * (apps/mobile/src/lib/ibeacon.ts) e il test di parità lo verifica.
 */
#ifndef IBEACON_FRAME_H
#define IBEACON_FRAME_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/** 2 (company) + 2 (tipo+lunghezza) + 16 (uuid) + 2 + 2 + 1 (potenza). */
#define IBEACON_MANUFACTURER_LEN 25

/**
 * Compone i "manufacturer specific data" dell'annuncio:
 *
 *   4C 00        company id Apple, little-endian
 *   02 15        tipo iBeacon + lunghezza del payload che segue (21)
 *   16 byte      UUID di prossimità, big-endian
 *   2 byte       major, big-endian
 *   2 byte       minor, big-endian
 *   1 byte       potenza calibrata a 1 m (int8)
 */
void ibeacon_build_manufacturer_data(const uint8_t uuid[16], uint16_t major,
                                     uint16_t minor, int8_t measured_power,
                                     uint8_t out[IBEACON_MANUFACTURER_LEN]);

#ifdef __cplusplus
}
#endif

#endif /* IBEACON_FRAME_H */
