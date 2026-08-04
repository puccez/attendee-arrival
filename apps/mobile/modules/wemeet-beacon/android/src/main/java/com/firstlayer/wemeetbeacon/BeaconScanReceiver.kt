package com.firstlayer.wemeetbeacon

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanResult
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * Il risveglio in prossimità su Android.
 *
 * Il sistema consegna qui i risultati della scansione BLE registrata via
 * PendingIntent, anche ad app chiusa: il frame del beacon-notaio si accoda
 * (BeaconStore) e, la prima volta della visita, parte la notifica one-tap.
 *
 * Toccarla apre il deep link dell'app: il tap è un segnale di qualità, mai
 * di provenienza — la prova resta il codice raccolto.
 */
class BeaconScanReceiver : BroadcastReceiver() {

  override fun onReceive(context: Context, intent: Intent) {
    val results = extractResults(intent)
    if (results.isEmpty()) return

    val now = System.currentTimeMillis()
    var sawBeacon = false

    for (result in results) {
      val payload = result.scanRecord?.getManufacturerSpecificData(APPLE_COMPANY_ID) ?: continue
      // getManufacturerSpecificData() toglie il company id: lo rimettiamo,
      // così i byte sono identici a quelli in onda e li interpreta lo
      // stesso parser condiviso dell'app (src/lib/ibeacon.ts).
      val frame = ByteArray(payload.size + 2)
      frame[0] = 0x4C
      frame[1] = 0x00
      System.arraycopy(payload, 0, frame, 2, payload.size)

      BeaconStore.append(context, frame, result.rssi, now)
      sawBeacon = true
    }

    if (sawBeacon && BeaconStore.shouldNotify(context, now, QUIET_PERIOD_MS)) {
      notifyArrival(context)
    }
  }

  private fun extractResults(intent: Intent): List<ScanResult> {
    val list = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      intent.getParcelableArrayListExtra(
        BluetoothLeScanner.EXTRA_LIST_SCAN_RESULT,
        ScanResult::class.java,
      )
    } else {
      @Suppress("DEPRECATION")
      intent.getParcelableArrayListExtra<ScanResult>(
        BluetoothLeScanner.EXTRA_LIST_SCAN_RESULT
      )
    }
    return list ?: emptyList()
  }

  private fun notifyArrival(context: Context) {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(
        NotificationChannel(
          CHANNEL_ID,
          "Arrivo al WeMeet",
          NotificationManager.IMPORTANCE_HIGH,
        )
      )
    }

    val deepLink = BeaconStore.notificationDeepLink(context)
    val launch = if (deepLink != null) {
      Intent(Intent.ACTION_VIEW, Uri.parse(deepLink)).apply {
        setPackage(context.packageName)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
    } else {
      context.packageManager.getLaunchIntentForPackage(context.packageName)
    } ?: return

    val pending = PendingIntent.getActivity(
      context,
      0,
      launch,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    val notification = NotificationCompat.Builder(context, CHANNEL_ID)
      .setContentTitle(BeaconStore.notificationTitle(context))
      .setContentText(BeaconStore.notificationBody(context))
      .setSmallIcon(context.applicationInfo.icon)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setAutoCancel(true)
      .setContentIntent(pending)
      .build()

    try {
      NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
    } catch (_: SecurityException) {
      // POST_NOTIFICATIONS negato: la porta della copertura non si chiude,
      // si etichetta — la raccolta dei codici continua lo stesso.
    }
  }

  private companion object {
    const val APPLE_COMPANY_ID = 0x004C
    const val CHANNEL_ID = "wemeet-arrival"
    const val NOTIFICATION_ID = 4201
    /** Una notifica per visita: silenzio per un'ora dopo la prima. */
    const val QUIET_PERIOD_MS = 60L * 60L * 1000L
  }
}
