package com.firstlayer.wemeetbeacon

import android.content.Context
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject

/**
 * La coda degli avvistamenti raccolti mentre l'app non era viva.
 *
 * Quando il sistema sveglia il receiver non c'è nessun runtime JS a cui
 * consegnare l'evento: il frame si accoda qui e l'app lo drena al risveglio.
 * È il dwell opportunistico visto dal lato Android — non campionamento
 * continuo, ma "quello che il telefono ha potuto sentire".
 */
internal object BeaconStore {
  private const val PREFS = "wemeet-beacon"
  private const val KEY_QUEUE = "sightings"
  private const val KEY_UUID = "expected-uuid"
  private const val KEY_LAST_NOTIFIED = "last-notified-at"
  private const val KEY_ANNOUNCED_PENDING = "announced-pending"
  private const val KEY_TITLE = "notification-title"
  private const val KEY_BODY = "notification-body"
  private const val KEY_DEEP_LINK = "notification-deep-link"

  /** Oltre questo, gli avvistamenti più vecchi cadono: il borsellino non è un log. */
  private const val MAX_QUEUED = 400

  private fun prefs(context: Context) =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun rememberNotification(context: Context, title: String, body: String, deepLink: String) {
    prefs(context).edit()
      .putString(KEY_TITLE, title)
      .putString(KEY_BODY, body)
      .putString(KEY_DEEP_LINK, deepLink)
      .apply()
  }

  /**
   * L'UUID che il receiver deve riconoscere. Il filtro hardware è corto di
   * proposito (vedi WemeetBeaconModule.filterFor): il confronto dei 16 byte
   * si fa qui, in software, così un iBeacon altrui non sveglia nessuno.
   */
  fun rememberUuid(context: Context, uuid: java.util.UUID) {
    val bytes = java.nio.ByteBuffer.allocate(16)
      .putLong(uuid.mostSignificantBits)
      .putLong(uuid.leastSignificantBits)
      .array()
    prefs(context).edit()
      .putString(KEY_UUID, bytes.joinToString("") { "%02x".format(it) })
      .apply()
  }

  fun expectedUuid(context: Context): ByteArray? {
    val hex = prefs(context).getString(KEY_UUID, null) ?: return null
    return ByteArray(hex.length / 2) { i ->
      hex.substring(i * 2, i * 2 + 2).toInt(16).toByte()
    }
  }

  fun notificationTitle(context: Context): String =
    prefs(context).getString(KEY_TITLE, "Sei arrivato") ?: "Sei arrivato"

  fun notificationBody(context: Context): String =
    prefs(context).getString(KEY_BODY, "Tocca per confermare la presenza")
      ?: "Tocca per confermare la presenza"

  fun notificationDeepLink(context: Context): String? =
    prefs(context).getString(KEY_DEEP_LINK, null)

  /**
   * Una sola notifica per visita: se abbiamo già avvisato di recente,
   * l'avvistamento si accoda in silenzio. Il telefono in tasca che vibra
   * ogni cinque secondi non è una feature.
   *
   * Questo silenzio è lo specchio nativo dello stato di transizione JS
   * (src/lib/arrival): quando annuncia il JS lo arma (`syncArrivalState`),
   * quando si esce dal confine si disarma — così geofence, region e
   * receiver producono UN annuncio, qualunque sia la strada. Il periodo di
   * quiete resta come rete di sicurezza per l'app mai risvegliata.
   */
  fun shouldNotify(context: Context, now: Long, quietMs: Long): Boolean {
    val last = prefs(context).getLong(KEY_LAST_NOTIFIED, 0L)
    if (now - last < quietMs) return false
    prefs(context).edit().putLong(KEY_LAST_NOTIFIED, now).apply()
    return true
  }

  /** Il receiver HA annunciato: al prossimo risveglio il JS deve saperlo. */
  fun markAnnouncedBySystem(context: Context) {
    prefs(context).edit().putBoolean(KEY_ANNOUNCED_PENDING, true).apply()
  }

  /** Legge e azzera: l'annuncio nativo si piega nello stato JS una volta sola. */
  fun consumeAnnouncedBySystem(context: Context): Boolean {
    val store = prefs(context)
    val pending = store.getBoolean(KEY_ANNOUNCED_PENDING, false)
    if (pending) store.edit().putBoolean(KEY_ANNOUNCED_PENDING, false).apply()
    return pending
  }

  /**
   * Allinea lo specchio alla transizione JS: «dentro» silenzia il receiver
   * (l'annuncio c'è già stato, da qualunque strada), «fuori» lo riarma —
   * il prossimo avvistamento è un rientro vero e va riannunciato.
   */
  fun syncArrivalState(context: Context, inside: Boolean, now: Long) {
    val edit = prefs(context).edit().putLong(KEY_LAST_NOTIFIED, if (inside) now else 0L)
    if (!inside) edit.putBoolean(KEY_ANNOUNCED_PENDING, false)
    edit.apply()
  }

  fun append(context: Context, manufacturerData: ByteArray, rssi: Int, at: Long) {
    val store = prefs(context)
    val queue = JSONArray(store.getString(KEY_QUEUE, "[]"))

    val entry = JSONObject()
      .put("manufacturerData", Base64.encodeToString(manufacturerData, Base64.NO_WRAP))
      .put("rssi", rssi)
      .put("at", at)
    queue.put(entry)

    val trimmed = if (queue.length() <= MAX_QUEUED) {
      queue
    } else {
      JSONArray().also { out ->
        for (i in (queue.length() - MAX_QUEUED) until queue.length()) {
          out.put(queue.get(i))
        }
      }
    }
    store.edit().putString(KEY_QUEUE, trimmed.toString()).apply()
  }

  /** Legge e svuota: gli avvistamenti passano al borsellino, non restano qui. */
  fun drain(context: Context): List<Map<String, Any>> {
    val store = prefs(context)
    val queue = JSONArray(store.getString(KEY_QUEUE, "[]"))
    store.edit().putString(KEY_QUEUE, "[]").apply()

    val out = mutableListOf<Map<String, Any>>()
    for (i in 0 until queue.length()) {
      val item = queue.optJSONObject(i) ?: continue
      out.add(
        mapOf(
          "manufacturerData" to item.optString("manufacturerData"),
          "rssi" to item.optInt("rssi"),
          "at" to item.optLong("at"),
        )
      )
    }
    return out
  }
}
