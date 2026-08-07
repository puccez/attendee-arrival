package com.firstlayer.wemeetbeacon

import android.Manifest
import android.app.PendingIntent
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Base64
import androidx.core.content.ContextCompat
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.nio.ByteBuffer
import java.util.UUID

/** Il testo della notifica di arrivo e dove porta il tap. */
class MonitoringOptions : Record {
  @Field val title: String = "Sei arrivato"

  @Field val body: String = "Tocca per confermare la presenza"

  @Field val deepLink: String = ""
}

/** Il testo della notifica persistente della modalità notaio. */
class NotaryOptions : Record {
  @Field val title: String = "Modalità notaio attiva"

  @Field val body: String = "Questo telefono sta emettendo il codice dell'evento"
}

/**
 * Il canale radio su Android: scansione diretta dei frame iBeacon.
 *
 * A differenza di iOS, Android consegna i manufacturer data grezzi
 * all'applicazione: il frame arriva intatto e lo interpreta il parser
 * condiviso in TypeScript (src/lib/ibeacon.ts) — una sola implementazione
 * del contratto dei byte, testata contro il firmware.
 *
 * In foreground si usa una ScanCallback; in background la stessa scansione
 * si registra con un PendingIntent, e il sistema sveglia BeaconScanReceiver.
 */
class WemeetBeaconModule : Module() {

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private var scanCallback: ScanCallback? = null
  private var backgroundIntent: PendingIntent? = null
  private var advertiseCallback: AdvertiseCallback? = null

  override fun definition() = ModuleDefinition {
    Name("WemeetBeacon")

    Events("onBeaconRanged", "onRegionEnter", "onRegionExit", "onNotaryState")

    Function("isSupported") {
      context.packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE) &&
        adapter()?.isEnabled == true
    }

    AsyncFunction("requestPermissionsAsync") {
      // Le richieste passano da PermissionsAndroid lato JS (sono permessi
      // standard): qui riportiamo solo lo stato corrente.
      mapOf(
        "location" to statusOf(Manifest.permission.ACCESS_FINE_LOCATION),
        "bluetooth" to if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          statusOf(Manifest.permission.BLUETOOTH_SCAN)
        } else {
          "granted"
        },
      )
    }

    AsyncFunction("startRangingAsync") { uuid: String ->
      val scanner = adapter()?.bluetoothLeScanner
        ?: throw CodedException("Bluetooth non disponibile o spento")
      stopForegroundScan()

      val callback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
          emit(listOf(result))
        }

        override fun onBatchScanResults(results: MutableList<ScanResult>) {
          emit(results)
        }
      }
      scanCallback = callback
      scanner.startScan(listOf(filterFor(uuid)), foregroundSettings(), callback)
    }

    AsyncFunction("stopRangingAsync") {
      stopForegroundScan()
    }

    AsyncFunction("startMonitoringAsync") { uuid: String, options: MonitoringOptions ->
      val scanner = adapter()?.bluetoothLeScanner
        ?: throw CodedException("Bluetooth non disponibile o spento")
      // La scansione via PendingIntent — cioè il risveglio ad app chiusa —
      // esiste solo da Android 8. Sotto, resta l'ascolto in foreground.
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
        throw CodedException("Il risveglio in prossimità richiede Android 8 o superiore")
      }

      BeaconStore.rememberNotification(
        context,
        options.title,
        options.body,
        options.deepLink,
      )
      BeaconStore.rememberUuid(context, UUID.fromString(uuid))

      stopBackgroundScan()
      val intent = Intent(context, BeaconScanReceiver::class.java)
      val pending = PendingIntent.getBroadcast(
        context,
        BACKGROUND_REQUEST_CODE,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
      )
      backgroundIntent = pending
      scanner.startScan(listOf(filterFor(uuid)), backgroundSettings(), pending)
    }

    AsyncFunction("stopMonitoringAsync") {
      stopBackgroundScan()
    }

    AsyncFunction("drainBackgroundSightingsAsync") {
      BeaconStore.drain(context)
    }

    // Il receiver ha annunciato mentre l'app era chiusa? Letto una volta,
    // si piega nello stato di transizione JS (vedi src/tasks.ts).
    AsyncFunction("consumeNativeArrivalAsync") {
      BeaconStore.consumeAnnouncedBySystem(context)
    }

    // Lo specchio nativo della transizione: dentro = receiver muto,
    // fuori = riarmato per il prossimo rientro.
    AsyncFunction("syncArrivalStateAsync") { inside: Boolean ->
      BeaconStore.syncArrivalState(context, inside, System.currentTimeMillis())
    }

    /*
     * Modalità notaio: il telefono dell'host mette in onda lo stesso frame
     * dell'ESP32. Richiamare la funzione con major/minor nuovi È la
     * rotazione del codice: la guida il driver JS a ogni finestra da 30 s —
     * la derivazione vive in un posto solo, quello coi vettori di parità.
     * Il foreground service (NotaryService) tiene vivo il processo a
     * schermo spento; l'advertiser sta qui, come lo scanner.
     */
    AsyncFunction("startAdvertisingAsync") { uuid: String, major: Int, minor: Int, options: NotaryOptions ->
      val advertiser = adapter()?.bluetoothLeAdvertiser
        ?: throw CodedException("Bluetooth non disponibile o spento")
      require(major in 0..0xFFFF && minor in 0..0xFFFF) {
        "major/minor fuori dal campo del frame"
      }

      NotaryService.start(context, options.title, options.body)
      stopAdvertise()

      val settings = AdvertiseSettings.Builder()
        // Bassa latenza = intervallo ~100 ms, coerente col firmware
        // (BEACON_ADV_INTERVAL): l'attendee campiona in low power e deve
        // trovare il frame al primo colpo d'orecchio.
        .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
        .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
        .setConnectable(false)
        .build()
      val data = AdvertiseData.Builder()
        .setIncludeDeviceName(false)
        .setIncludeTxPowerLevel(false)
        // addManufacturerData antepone da sé il company id (0x004C):
        // il payload parte da 0x02 0x15, come in ibeacon_frame.c.
        .addManufacturerData(APPLE_COMPANY_ID, ibeaconPayload(uuid, major, minor))
        .build()

      val callback = object : AdvertiseCallback() {
        override fun onStartSuccess(settingsInEffect: AdvertiseSettings) {
          sendEvent("onNotaryState", mapOf("advertising" to true, "bluetooth" to "acceso"))
        }

        override fun onStartFailure(errorCode: Int) {
          sendEvent(
            "onNotaryState",
            mapOf(
              "advertising" to false,
              "bluetooth" to "acceso",
              "error" to advertiseError(errorCode),
            ),
          )
        }
      }
      advertiseCallback = callback
      try {
        advertiser.startAdvertising(settings, data, callback)
      } catch (e: SecurityException) {
        advertiseCallback = null
        NotaryService.stop(context)
        throw CodedException("Permesso BLUETOOTH_ADVERTISE negato", e)
      }
    }

    AsyncFunction("stopAdvertisingAsync") {
      stopAdvertise()
      NotaryService.stop(context)
      sendEvent("onNotaryState", mapOf("advertising" to false))
    }

    OnDestroy {
      stopForegroundScan()
      stopAdvertise()
      NotaryService.stop(context)
    }
  }

  /* ------------------------------------------------------------ scansione */

  private fun adapter(): BluetoothAdapter? =
    (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

  private fun statusOf(permission: String): String =
    if (ContextCompat.checkSelfPermission(context, permission) ==
      PackageManager.PERMISSION_GRANTED
    ) "granted" else "denied"

  /**
   * Filtro sui manufacturer data: solo frame iBeacon (prefisso 02 15 dopo
   * il company id Apple). CORTO DI PROPOSITO: il filtro lungo col confronto
   * dei 16 byte dell'UUID sta oltre i limiti del filtro hardware di molti
   * chip economici, che in quel caso scartano TUTTO in silenzio — il primo
   * telefono vero (Redmi, Android 10) non sentiva un iPhone a dieci
   * centimetri. Il cancello vero è il parser condiviso lato app
   * (src/lib/ibeacon.ts): rilegge i byte, verifica company id, tipo e
   * UUID, ed è testato contro il firmware. Qui si sgrossa e basta.
   */
  private fun filterFor(@Suppress("UNUSED_PARAMETER") uuid: String): ScanFilter {
    val pattern = byteArrayOf(0x02, 0x15)
    val mask = byteArrayOf(0xFF.toByte(), 0xFF.toByte())

    return ScanFilter.Builder()
      .setManufacturerData(APPLE_COMPANY_ID, pattern, mask)
      .build()
  }

  private fun foregroundSettings(): ScanSettings =
    ScanSettings.Builder()
      .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
      .setReportDelay(0)
      .build()

  /**
   * In background si scende a bassa potenza: la permanenza si campiona
   * opportunisticamente, non in continuo — la batteria dell'attendee non è
   * un costo che il sistema può permettersi.
   */
  private fun backgroundSettings(): ScanSettings =
    ScanSettings.Builder()
      .setScanMode(ScanSettings.SCAN_MODE_LOW_POWER)
      .setReportDelay(0)
      .build()

  private fun emit(results: List<ScanResult>) {
    val now = System.currentTimeMillis()
    val beacons = results.mapNotNull { result ->
      val payload = result.scanRecord?.getManufacturerSpecificData(APPLE_COMPANY_ID)
        ?: return@mapNotNull null
      // Rimettiamo il company id: i byte tornano identici a quelli in onda.
      val frame = ByteArray(payload.size + 2)
      frame[0] = 0x4C
      frame[1] = 0x00
      System.arraycopy(payload, 0, frame, 2, payload.size)

      mapOf(
        "manufacturerData" to Base64.encodeToString(frame, Base64.NO_WRAP),
        "rssi" to result.rssi,
        "at" to now,
      )
    }
    if (beacons.isEmpty()) return
    sendEvent("onBeaconRanged", mapOf("beacons" to beacons))
  }

  private fun stopForegroundScan() {
    val callback = scanCallback ?: return
    scanCallback = null
    try {
      adapter()?.bluetoothLeScanner?.stopScan(callback)
    } catch (_: Exception) {
      // Bluetooth spento nel frattempo: niente da fermare.
    }
  }

  private fun stopBackgroundScan() {
    val pending = backgroundIntent ?: return
    backgroundIntent = null
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    try {
      adapter()?.bluetoothLeScanner?.stopScan(pending)
    } catch (_: Exception) {
    }
  }

  /* ----------------------------------------------------------- emissione */

  /**
   * Il payload iBeacon senza company id: tipo, lunghezza, UUID, major,
   * minor, potenza calibrata — speculare a ibeacon_frame.c e al parser
   * condiviso (src/lib/ibeacon.ts), che è chi lo rileggerà dall'altra parte.
   */
  private fun ibeaconPayload(uuid: String, major: Int, minor: Int): ByteArray {
    val parsed = UUID.fromString(uuid)
    val payload = ByteBuffer.allocate(23)
    payload.put(0x02.toByte())
    payload.put(0x15.toByte())
    payload.putLong(parsed.mostSignificantBits)
    payload.putLong(parsed.leastSignificantBits)
    payload.putShort(major.toShort())
    payload.putShort(minor.toShort())
    payload.put(MEASURED_POWER_DBM)
    return payload.array()
  }

  private fun advertiseError(code: Int): String = when (code) {
    AdvertiseCallback.ADVERTISE_FAILED_DATA_TOO_LARGE -> "frame troppo grande"
    AdvertiseCallback.ADVERTISE_FAILED_TOO_MANY_ADVERTISERS -> "radio satura di annunci"
    AdvertiseCallback.ADVERTISE_FAILED_ALREADY_STARTED -> "annuncio già in onda"
    AdvertiseCallback.ADVERTISE_FAILED_INTERNAL_ERROR -> "errore interno del Bluetooth"
    AdvertiseCallback.ADVERTISE_FAILED_FEATURE_UNSUPPORTED -> "questo telefono non sa emettere"
    else -> "errore $code"
  }

  private fun stopAdvertise() {
    val callback = advertiseCallback ?: return
    advertiseCallback = null
    try {
      adapter()?.bluetoothLeAdvertiser?.stopAdvertising(callback)
    } catch (_: Exception) {
      // Bluetooth spento nel frattempo: niente da fermare.
    }
  }

  private companion object {
    const val APPLE_COMPANY_ID = 0x004C
    const val BACKGROUND_REQUEST_CODE = 4201

    /** Potenza calibrata a 1 m dichiarata nel frame: -59 dBm (config.h). */
    const val MEASURED_POWER_DBM = (-59).toByte()
  }
}
