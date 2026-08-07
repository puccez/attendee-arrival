package com.firstlayer.wemeetbeacon

/**
 * L'estrazione dei blocchi manufacturer Apple dai byte grezzi di un
 * annuncio BLE.
 *
 * Perché a mano e non con ScanRecord.getManufacturerSpecificData()? Perché
 * quell'API tiene UN blocco solo per produttore: se l'annuncio ne porta
 * due, l'ultimo sovrascrive il primo. E l'iPhone in primo piano fa
 * esattamente questo — frame iBeacon nell'annuncio, frame «overflow area»
 * (tipo 01) accodato per farsi sentire dagli altri iPhone in background:
 * stesso company id 0x004C, due blocchi. L'API restituiva solo il secondo
 * e il beacon spariva prima di arrivare al parser: il «silenzio radio»
 * del Redmi era tutto qui, con il frame intatto nei byte grezzi.
 *
 * Le strutture AD sono [lunghezza][tipo][dati]: si cammina blocco per
 * blocco e si raccolgono TUTTI i payload Apple, nell'ordine in cui sono
 * in aria. Il cancello vero resta il parser condiviso (src/lib/ibeacon.ts).
 */
internal object AppleFrames {
  private const val TYPE_MANUFACTURER = 0xFF.toByte()
  private const val COMPANY_LOW = 0x4C.toByte()
  private const val COMPANY_HIGH = 0x00.toByte()

  /** Tutti i payload Apple del record (senza company id). */
  fun blocks(raw: ByteArray?): List<ByteArray> {
    if (raw == null) return emptyList()
    val out = mutableListOf<ByteArray>()
    var i = 0
    while (i < raw.size) {
      val length = raw[i].toInt() and 0xFF
      if (length == 0) break // inizio del padding: il record è finito
      val end = i + 1 + length
      if (end > raw.size) break // struttura tronca: meglio fermarsi
      if (
        length >= 3 &&
        raw[i + 1] == TYPE_MANUFACTURER &&
        raw[i + 2] == COMPANY_LOW &&
        raw[i + 3] == COMPANY_HIGH
      ) {
        out.add(raw.copyOfRange(i + 4, end))
      }
      i = end
    }
    return out
  }
}
