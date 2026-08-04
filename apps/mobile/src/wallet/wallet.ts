import * as SQLite from "expo-sqlite";

import { postDelivery, type ApiCheckIn } from "../lib/api";
import {
  deliveryOutcome,
  groupIntoDeliveries,
  type WalletItem,
} from "../lib/delivery";

/**
 * Il borsellino dell'attendee.
 *
 * I Codici Rotanti si raccolgono in locale — la raccolta è radio, non rete —
 * e salgono alla cucitura di verifica appena c'è campo. Offline non è un
 * caso d'errore: è il funzionamento normale in un locale interrato.
 *
 * Stessa strategia del web (apps/web/app/powersync/connector.ts): gli item
 * si raggruppano per evento in un'unica consegna. Qui la coda è SQLite
 * locale invece della crud queue di PowerSync — l'interfaccia è la stessa e
 * lo swap è preparato (vedi README.md, "Il borsellino e PowerSync").
 */

let database: SQLite.SQLiteDatabase | null = null;

async function db(): Promise<SQLite.SQLiteDatabase> {
  if (database) return database;
  const opened = await SQLite.openDatabaseAsync("wemeet-wallet.db");
  await opened.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS wallet_items (
      id TEXT PRIMARY KEY NOT NULL,
      event_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      value TEXT,
      collected_at TEXT,
      gps_inside INTEGER NOT NULL DEFAULT 0,
      confirmation_tap INTEGER NOT NULL DEFAULT 0,
      attendee_name TEXT,
      delivered_at TEXT
    );

    -- Un codice per finestra per evento, per sempre: la riga consegnata
    -- resta (marcata) invece di sparire, così ri-sentire lo stesso codice
    -- non produce una seconda consegna.
    CREATE UNIQUE INDEX IF NOT EXISTS wallet_code_unique
      ON wallet_items (event_id, value) WHERE kind = 'code';

    CREATE TABLE IF NOT EXISTS check_ins (
      event_id TEXT PRIMARY KEY NOT NULL,
      result TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
  `);
  database = opened;
  return opened;
}

/* ------------------------------------------------------------- settings */

export async function readSetting(key: string): Promise<string | null> {
  const row = await (
    await db()
  ).getFirstAsync<{ value: string }>(
    "SELECT value FROM settings WHERE key = ?",
    key,
  );
  return row?.value ?? null;
}

export async function writeSetting(key: string, value: string): Promise<void> {
  await (
    await db()
  ).runAsync(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    key,
    value,
  );
}

/**
 * L'identità del device: stabile, locale, senza account. È ciò che la prova
 * di prossimità dimostra — il device, non la persona (per la persona serve
 * la testimonianza umana dell'host).
 */
export async function getDeviceId(): Promise<string> {
  const existing = await readSetting("device-id");
  if (existing) return existing;
  const generated = `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 12)}`;
  await writeSetting("device-id", generated);
  return generated;
}

/* ------------------------------------------------------------ raccolta */

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Mette un Codice Rotante nel borsellino. Ritorna false se era già dentro:
 * il beacon riemette lo stesso codice per tutta la finestra di 30 s e non ha
 * senso accumularlo trenta volte.
 */
export async function collectCode(
  eventId: string,
  value: string,
  collectedAt: Date = new Date(),
): Promise<boolean> {
  const result = await (
    await db()
  ).runAsync(
    `INSERT OR IGNORE INTO wallet_items (id, event_id, kind, value, collected_at)
     VALUES (?, ?, 'code', ?, ?)`,
    newId(),
    eventId,
    value,
    collectedAt.toISOString(),
  );
  return result.changes > 0;
}

/**
 * Registra il contesto dell'Arrivo: il geofence attraversato, il tap sulla
 * notifica. L'Arrivo NON è un check-in — è l'invito a produrne uno.
 */
export async function markArrival(
  eventId: string,
  context: { gpsInside?: boolean; confirmationTap?: boolean },
): Promise<void> {
  await (
    await db()
  ).runAsync(
    `INSERT INTO wallet_items (id, event_id, kind, gps_inside, confirmation_tap)
     VALUES (?, ?, 'arrival', ?, ?)`,
    newId(),
    eventId,
    context.gpsInside ? 1 : 0,
    context.confirmationTap ? 1 : 0,
  );
}

export async function setAttendeeName(name: string): Promise<void> {
  await writeSetting("attendee-name", name);
}

export async function getAttendeeName(): Promise<string> {
  return (await readSetting("attendee-name")) ?? "";
}

/* ------------------------------------------------------------ consegna */

interface WalletRow {
  id: string;
  event_id: string;
  kind: string;
  value: string | null;
  collected_at: string | null;
  gps_inside: number;
  confirmation_tap: number;
}

async function pendingRows(): Promise<WalletItem[]> {
  const rows = await (
    await db()
  ).getAllAsync<WalletRow>(
    "SELECT id, event_id, kind, value, collected_at, gps_inside, confirmation_tap FROM wallet_items WHERE delivered_at IS NULL ORDER BY collected_at",
  );
  const attendeeName = (await getAttendeeName()) || null;
  return rows.map((row) => ({
    id: row.id,
    eventId: row.event_id,
    kind: row.kind === "code" ? "code" : "arrival",
    value: row.value,
    collectedAt: row.collected_at,
    gpsInside: row.gps_inside === 1,
    confirmationTap: row.confirmation_tap === 1,
    attendeeName,
  }));
}

/** Quanti codici aspettano ancora di essere consegnati. */
export async function pendingCodeCount(eventId: string): Promise<number> {
  const row = await (
    await db()
  ).getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM wallet_items WHERE event_id = ? AND kind = 'code' AND delivered_at IS NULL",
    eventId,
  );
  return row?.n ?? 0;
}

/** Quanti codici distinti l'app ha sentito in tutto, per questo evento. */
export async function collectedCodeCount(eventId: string): Promise<number> {
  const row = await (
    await db()
  ).getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM wallet_items WHERE event_id = ? AND kind = 'code'",
    eventId,
  );
  return row?.n ?? 0;
}

export async function lastCheckIn(eventId: string): Promise<ApiCheckIn | null> {
  const row = await (
    await db()
  ).getFirstAsync<{ result: string }>(
    "SELECT result FROM check_ins WHERE event_id = ?",
    eventId,
  );
  if (!row) return null;
  try {
    return JSON.parse(row.result) as ApiCheckIn;
  } catch {
    return null;
  }
}

export interface FlushReport {
  delivered: number;
  retryLater: number;
  checkIns: ApiCheckIn[];
}

/**
 * Svuota il borsellino verso la cucitura di verifica.
 *
 * Un 2xx o un 4xx consumano gli item (il server ha deciso: una consegna
 * malformata non deve bloccare la coda per sempre). Un errore di rete o un
 * 5xx li lascia dove sono: si ritenta. Questo È il borsellino che aspetta
 * la rete.
 */
export async function flush(deviceId: string): Promise<FlushReport> {
  const items = await pendingRows();
  const report: FlushReport = { delivered: 0, retryLater: 0, checkIns: [] };
  if (items.length === 0) return report;

  const now = new Date().toISOString();
  for (const delivery of groupIntoDeliveries(items, deviceId)) {
    let status: number;
    let checkIn: ApiCheckIn | null = null;
    try {
      const response = await postDelivery(delivery.eventId, delivery.payload);
      status = response.status;
      checkIn = response.checkIn;
    } catch {
      status = 0; // offline: si ritenta
    }

    if (deliveryOutcome(status) === "retry") {
      report.retryLater += delivery.itemIds.length;
      continue;
    }

    const placeholders = delivery.itemIds.map(() => "?").join(",");
    await (
      await db()
    ).runAsync(
      `UPDATE wallet_items SET delivered_at = ? WHERE id IN (${placeholders})`,
      now,
      ...delivery.itemIds,
    );
    report.delivered += delivery.itemIds.length;

    if (checkIn) {
      report.checkIns.push(checkIn);
      await (
        await db()
      ).runAsync(
        `INSERT INTO check_ins (event_id, result, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(event_id) DO UPDATE SET result = excluded.result, updated_at = excluded.updated_at`,
        delivery.eventId,
        JSON.stringify(checkIn),
        checkIn.updatedAt,
      );
    }
  }

  return report;
}
