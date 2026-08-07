package com.firstlayer.wemeetbeacon

import android.bluetooth.BluetoothManager
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.util.Log

/**
 * Il banco di prova della radio: sei configurazioni di scansione, una alla
 * volta, quindici secondi ciascuna, verdetto nel logcat (tag WemeetScanLab).
 *
 * Esiste perché il primo telefono vero (Redmi 9C, Android 10) sente i frame
 * Apple generici ma mai un iBeacon — pur con l'emittente verificata da una
 * terza radio. Da fuori non si distingue se il frame muore nel chip, nello
 * stack del produttore o nella nostra configurazione: qui la stessa domanda
 * si fa in sei modi diversi, e lo strato colpevole si riconosce da quale
 * configurazione (se una) lascia passare il frame.
 *
 * Si aziona da adb, senza toccare lo schermo:
 *
 *   adb shell am broadcast \
 *     -n com.firstlayer.wemeetattendee/com.firstlayer.wemeetbeacon.ScanLabReceiver \
 *     -a com.firstlayer.wemeetbeacon.SCAN_LAB
 *
 * Il receiver è protetto dal permesso DUMP: ce l'ha la shell adb, non le
 * app di terze parti.
 */
internal object ScanLab {
  private const val TAG = "WemeetScanLab"
  private const val APPLE_COMPANY_ID = 0x004C
  private const val STAGE_MS = 15_000L

  private var running = false

  private class Stage(
    val name: String,
    val filters: List<ScanFilter>?,
    val settings: ScanSettings,
  )

  /** Il funnel di una configurazione: quanto sopravvive a ogni gradino. */
  private class Collector(private val huntUuid: ByteArray?) : ScanCallback() {
    var total = 0
    var apple = 0
    var ibeacon = 0
    var failure: Int? = null
    val devices = HashSet<String>()
    val types = HashMap<String, Int>()
    val beacons = HashMap<String, Int>()

    /* La caccia ai byte grezzi: se lo stack storpiasse il frame (byte
       spostati, tipo riscritto), l'UUID resterebbe comunque da qualche
       parte nel buffer. Qui si cerca la sua firma OVUNQUE, ignorando la
       struttura — e si tiene un campione grezzo per ogni tipo Apple, per
       decifrare a occhio cosa sono davvero. */
    var uuidHits = 0
    val uuidSamples = ArrayList<String>(3)
    val typeSamples = HashMap<String, String>()

    override fun onScanResult(callbackType: Int, result: ScanResult) = tally(listOf(result))

    override fun onBatchScanResults(results: MutableList<ScanResult>) = tally(results)

    override fun onScanFailed(errorCode: Int) {
      failure = errorCode
    }

    private fun tally(results: List<ScanResult>) {
      for (result in results) {
        total++
        devices.add(result.device?.address ?: "?")
        val raw = result.scanRecord?.bytes
        if (raw != null && huntUuid != null && indexOf(raw, huntUuid) >= 0) {
          uuidHits++
          if (uuidSamples.size < 3) {
            uuidSamples.add(
              "${result.device?.address} rssi=${result.rssi} " +
                raw.joinToString("") { "%02x".format(it) }.replace(Regex("(00)+$"), "")
            )
          }
        }
        val payload = result.scanRecord?.getManufacturerSpecificData(APPLE_COMPANY_ID)
          ?: continue
        apple++
        if (payload.isEmpty()) continue
        val type = "%02x".format(payload[0])
        types[type] = (types[type] ?: 0) + 1
        if (!typeSamples.containsKey(type)) {
          typeSamples[type] = payload.joinToString("") { "%02x".format(it) }
        }
        if (payload.size >= 23 && payload[0] == 0x02.toByte() && payload[1] == 0x15.toByte()) {
          ibeacon++
          val uuid = payload.copyOfRange(2, 18).joinToString("") { "%02x".format(it) }
          val major = (payload[18].toInt() and 0xFF shl 8) or (payload[19].toInt() and 0xFF)
          val minor = (payload[20].toInt() and 0xFF shl 8) or (payload[21].toInt() and 0xFF)
          val key = "$uuid major=$major minor=$minor"
          beacons[key] = (beacons[key] ?: 0) + 1
        }
      }
    }

    private fun indexOf(haystack: ByteArray, needle: ByteArray): Int {
      if (needle.isEmpty() || haystack.size < needle.size) return -1
      outer@ for (i in 0..haystack.size - needle.size) {
        for (j in needle.indices) {
          if (haystack[i + j] != needle[j]) continue@outer
        }
        return i
      }
      return -1
    }

    fun describe(name: String): String {
      val tipi = types.entries
        .sortedByDescending { it.value }
        .joinToString(",") { "${it.key}×${it.value}" }
      val visti = beacons.entries.joinToString(" | ") { "${it.key} ×${it.value}" }
      return "config=$name totale=$total dispositivi=${devices.size} apple=$apple " +
        "tipi={$tipi} ibeacon=$ibeacon" +
        (if (huntUuid != null) " caccia-uuid=$uuidHits" else "") +
        (if (visti.isNotEmpty()) " visti=[$visti]" else "") +
        (failure?.let { " ERRORE_SCANSIONE=$it" } ?: "")
    }
  }

  fun run(context: Context) {
    synchronized(this) {
      if (running) {
        Log.i(TAG, "giro già in corso, ignoro")
        return
      }
      running = true
    }
    val adapter =
      (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
    val scanner = adapter?.bluetoothLeScanner
    if (adapter?.isEnabled != true || scanner == null) {
      Log.e(TAG, "bluetooth spento o assente: niente giro")
      synchronized(this) { running = false }
      return
    }
    val stages = ArrayDeque(buildStages(context))
    // La firma da braccare nei byte grezzi: i primi sei byte dell'UUID
    // bastano a riconoscerlo anche se lo stack ne storpiasse la coda.
    val hunt = BeaconStore.expectedUuid(context)?.copyOfRange(0, 6)
    Log.i(TAG, "giro di prova radio: ${stages.size} configurazioni × ${STAGE_MS / 1000}s")
    val thread = HandlerThread("wemeet-scan-lab").apply { start() }
    val handler = Handler(thread.looper)
    handler.post { step(scanner, handler, thread, stages, hunt) }
  }

  private fun step(
    scanner: BluetoothLeScanner,
    handler: Handler,
    thread: HandlerThread,
    stages: ArrayDeque<Stage>,
    hunt: ByteArray?,
  ) {
    val stage = stages.removeFirstOrNull()
    if (stage == null) {
      Log.i(TAG, "giro concluso")
      synchronized(this) { running = false }
      thread.quitSafely()
      return
    }
    val collector = Collector(hunt)
    try {
      scanner.startScan(stage.filters, stage.settings, collector)
      Log.i(TAG, "in prova: ${stage.name}")
    } catch (e: Exception) {
      Log.e(TAG, "config=${stage.name} avvio fallito: $e")
      handler.post { step(scanner, handler, thread, stages, hunt) }
      return
    }
    handler.postDelayed({
      // Il lotto consegna a intervalli: uno scarico esplicito prima dello
      // stop, o i frame dell'ultima finestra restano nel chip.
      try {
        scanner.flushPendingScanResults(collector)
      } catch (_: Exception) {
      }
      handler.postDelayed({
        try {
          scanner.stopScan(collector)
        } catch (_: Exception) {
        }
        Log.i(TAG, collector.describe(stage.name))
        for (preda in collector.uuidSamples) {
          Log.i(TAG, "  preda: $preda")
        }
        for ((tipo, esempio) in collector.typeSamples.toSortedMap()) {
          Log.i(TAG, "  tipo $tipo esempio=$esempio")
        }
        step(scanner, handler, thread, stages, hunt)
      }, 700)
    }, STAGE_MS)
  }

  private fun buildStages(context: Context): List<Stage> {
    fun settings(mode: Int, delay: Long = 0): ScanSettings.Builder =
      ScanSettings.Builder().setScanMode(mode).setReportDelay(delay)

    val stages = mutableListOf(
      // La configurazione dell'app oggi: nessun filtro, tutto lo spettro.
      Stage("libera", null, settings(ScanSettings.SCAN_MODE_LOW_LATENCY).build()),
      // Il filtro hardware corto del receiver: prefisso iBeacon e basta.
      Stage("filtro-0215", listOf(shortFilter()), settings(ScanSettings.SCAN_MODE_LOW_LATENCY).build()),
    )
    // Il filtro lungo che il chip del Redmi scartava in silenzio: resta nel
    // giro apposta, per documentare il comportamento del filtro hardware.
    BeaconStore.expectedUuid(context)?.let { uuid ->
      val pattern = byteArrayOf(0x02, 0x15) + uuid
      val mask = ByteArray(pattern.size) { 0xFF.toByte() }
      stages.add(
        Stage(
          "filtro-uuid-intero",
          listOf(ScanFilter.Builder().setManufacturerData(APPLE_COMPANY_ID, pattern, mask).build()),
          settings(ScanSettings.SCAN_MODE_LOW_LATENCY).build(),
        )
      )
    }
    // A lotti: il chip accumula e consegna ogni secondo — un percorso
    // diverso dentro il controller, a volte sente ciò che il diretto perde.
    stages.add(Stage("lotto-1s", null, settings(ScanSettings.SCAN_MODE_LOW_LATENCY, 1000).build()))
    stages.add(Stage("bilanciata", null, settings(ScanSettings.SCAN_MODE_BALANCED).build()))
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      // Anche gli annunci non-legacy (extended advertising): se il frame
      // viaggiasse lì, la scansione legacy di default non lo vedrebbe mai.
      stages.add(
        Stage(
          "anche-non-legacy",
          null,
          settings(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .setLegacy(false)
            .setPhy(ScanSettings.PHY_LE_ALL_SUPPORTED)
            .build(),
        )
      )
    }
    return stages
  }

  private fun shortFilter(): ScanFilter =
    ScanFilter.Builder()
      .setManufacturerData(
        APPLE_COMPANY_ID,
        byteArrayOf(0x02, 0x15),
        byteArrayOf(0xFF.toByte(), 0xFF.toByte()),
      )
      .build()
}

/** Il campanello del banco di prova: lo suona solo adb (permesso DUMP). */
class ScanLabReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    ScanLab.run(context.applicationContext)
  }
}
