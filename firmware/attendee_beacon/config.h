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

/*
 * L'API del battito: il beacon si presenta ogni BEACON_HEARTBEAT_INTERVAL_MS
 * e la risposta è il suo incarico (evento + seme, o «libero»). Il verso è
 * pull di necessità — la scheda sta dietro NAT — ed è anche ciò che rende
 * il web capace di dire «connesso adesso»: un battito recente.
 * Sovrascrivibile via seriale con `api <url>` (utile per puntare a un
 * server locale in sviluppo).
 */
#define BEACON_DEFAULT_API_BASE "https://attendee-arrival-api.vercel.app"
#define BEACON_HEARTBEAT_INTERVAL_MS 20000

/* Potenza calibrata a 1 m dichiarata nel frame iBeacon (int8, dBm). */
/* Nome annunciato nella scan response: serve solo a chi verifica con uno
 * scanner BLE generico (il payload iBeacon riempie già i 31 byte). */
#define BEACON_NAME "wemeet-notaio"

#define BEACON_MEASURED_POWER (-59)

/* Intervallo di advertising in unità da 0,625 ms (160 = 100 ms). */
#define BEACON_ADV_INTERVAL 160

#endif /* BEACON_CONFIG_H */
