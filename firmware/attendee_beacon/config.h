/*
 * Configurazione di default del beacon-notaio.
 *
 * Tutto quello che sta qui è solo il DEFAULT di fabbrica: a runtime i valori
 * si sovrascrivono via seriale (comandi `seed`, `uuid`, `wifi`) e finiscono
 * in NVS, così cambiare evento non richiede riflashare. Vedi README.md.
 */
#ifndef BEACON_CONFIG_H
#define BEACON_CONFIG_H

/*
 * UUID di prossimità — l'IDENTITÀ del beacon, non un segreto.
 * NON deve ruotare: è ciò su cui iOS registra la region e su cui sveglia
 * l'app in background. Il segreto che ruota sta in major/minor.
 * Lo stesso valore è cablato nell'app attendee (apps/mobile).
 */
#define BEACON_DEFAULT_UUID "B6C60396-4B64-44D6-84E7-54909270550C"

/*
 * Seme dell'evento — quello restituito da POST /events (64 char esadecimali).
 * Placeholder: sovrascrivilo via seriale con `seed <hex>` prima della demo.
 * È un segreto per-evento: la sua compromissione non eccede la fiducia già
 * riposta nell'host di quell'evento (vedi CONTEXT.md).
 */
#define BEACON_DEFAULT_SEED "0000000000000000000000000000000000000000000000000000000000000000"

/* Rete per la sincronizzazione NTP. Vuote = provisioning via seriale. */
#define BEACON_DEFAULT_WIFI_SSID ""
#define BEACON_DEFAULT_WIFI_PASSWORD ""

/* Potenza calibrata a 1 m dichiarata nel frame iBeacon (int8, dBm). */
#define BEACON_MEASURED_POWER (-59)

/* Intervallo di advertising in unità da 0,625 ms (160 = 100 ms). */
#define BEACON_ADV_INTERVAL 160

#endif /* BEACON_CONFIG_H */
