package com.firstlayer.wemeetbeacon

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * Il servizio che tiene vivo il notaio a schermo spento.
 *
 * Su Android l'advertising BLE non ha bisogno del servizio: ha bisogno che
 * il PROCESSO resti vivo, perché la rotazione del codice ogni 30 secondi la
 * guida il driver JS (una sola implementazione della derivazione, quella
 * testata coi vettori di parità). Un foreground service è il contratto con
 * cui Android promette di non ucciderlo — e la notifica persistente è il
 * prezzo dichiarato: l'host DEVE sapere che il suo telefono sta emettendo.
 *
 * Il servizio non tocca la radio: l'advertiser vive nel modulo, questo si
 * limita a esistere.
 */
class NotaryService : Service() {

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "Modalità notaio attiva"
    val body = intent?.getStringExtra(EXTRA_BODY)
      ?: "Questo telefono sta emettendo il codice dell'evento"

    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(
        NotificationChannel(
          CHANNEL_ID,
          "Modalità notaio",
          // Bassa importanza: deve vedersi nella tendina, non suonare.
          NotificationManager.IMPORTANCE_LOW,
        )
      )
    }

    val notification = NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle(title)
      .setContentText(body)
      .setSmallIcon(applicationInfo.icon)
      .setOngoing(true)
      .build()

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE,
      )
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    // Se il sistema lo uccide lo stesso, meglio morto che zombie: senza il
    // driver JS non c'è rotazione, e un notaio che riparte da solo
    // emetterebbe un codice congelato — cioè scaduto.
    return START_NOT_STICKY
  }

  companion object {
    private const val EXTRA_TITLE = "title"
    private const val EXTRA_BODY = "body"
    private const val CHANNEL_ID = "wemeet-notaio"
    private const val NOTIFICATION_ID = 4202

    fun start(context: Context, title: String, body: String) {
      val intent = Intent(context, NotaryService::class.java)
        .putExtra(EXTRA_TITLE, title)
        .putExtra(EXTRA_BODY, body)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, NotaryService::class.java))
    }
  }
}
