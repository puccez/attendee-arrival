import { column, Schema, Table } from "@powersync/web";

/**
 * wallet_items — il borsellino: raccolto in locale, sale al server via
 * uploadData (la cucitura di verifica). Il server non lo sincronizza
 * indietro: la riga consegnata scompare, lo stato arriva da check_ins.
 */
const wallet_items = new Table({
  event_id: column.text,
  kind: column.text, // 'code' | 'arrival'
  value: column.text, // il Codice Rotante (per kind='code')
  collected_at: column.text, // ISO
  gps_inside: column.integer,
  confirmation_tap: column.integer,
  attendee_name: column.text,
});

/** check_ins — lo stato etichettato, sincronizzato giù dal sync stream. */
const check_ins = new Table({
  event_id: column.text,
  device_id: column.text,
  attendee_name: column.text,
  result: column.text, // JSON del CheckIn (provenienza × qualità)
  updated_at: column.text,
});

export const AppSchema = new Schema({ wallet_items, check_ins });
export type Database = (typeof AppSchema)["types"];
