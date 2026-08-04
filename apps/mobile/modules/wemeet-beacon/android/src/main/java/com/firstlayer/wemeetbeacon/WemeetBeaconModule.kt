package com.firstlayer.wemeetbeacon

import android.Manifest
import android.app.PendingIntent
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
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

  override fun definition() = ModuleDefinition {
    Name("WemeetBeacon")

    Events("onBeaconRanged", "onRegionEnter", "onRegionExit")

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

    OnDestroy {
      stopForegroundScan()
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
   * Filtro sui manufacturer data: solo i frame iBeacon con il NOSTRO UUID.
   * Il pattern parte dopo il company id — 02 15 seguito dai 16 byte
   * dell'UUID — e la maschera li rende tutti significativi.
   */
  private fun filterFor(uuid: String): ScanFilter {
    val parsed = UUID.fromString(uuid)
    val uuidBytes = ByteBuffer.allocate(16)
      .putLong(parsed.mostSignificantBits)
      .putLong(parsed.leastSignificantBits)
      .array()

    val pattern = ByteArray(18)
    pattern[0] = 0x02
    pattern[1] = 0x15
    System.arraycopy(uuidBytes, 0, pattern, 2, 16)
    val mask = ByteArray(18) { 0xFF.toByte() }

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

  private companion object {
    const val APPLE_COMPANY_ID = 0x004C
    const val BACKGROUND_REQUEST_CODE = 4201
  }
}
