#include "ibeacon_frame.h"

#include <string.h>

void ibeacon_build_manufacturer_data(const uint8_t uuid[16], uint16_t major,
                                     uint16_t minor, int8_t measured_power,
                                     uint8_t out[IBEACON_MANUFACTURER_LEN]) {
  size_t i = 0;
  out[i++] = 0x4C; /* Apple, little-endian */
  out[i++] = 0x00;
  out[i++] = 0x02; /* tipo iBeacon */
  out[i++] = 0x15; /* 21 byte di payload a seguire */
  memcpy(out + i, uuid, 16);
  i += 16;
  out[i++] = (uint8_t)(major >> 8); /* big-endian, come da spec Apple */
  out[i++] = (uint8_t)(major & 0xFF);
  out[i++] = (uint8_t)(minor >> 8);
  out[i++] = (uint8_t)(minor & 0xFF);
  out[i++] = (uint8_t)measured_power;
}
