import * as SQLite from "expo-sqlite";

import { postDelivery, postTelemetry, type ApiCheckIn } from "../lib/api";
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

/**
 * Si memorizza la PROMESSA d'apertura, non l'handle: all'avvio dell'app il
 * borsellino viene chiamato da dieci punti insieme, e con l'handle come
 * guardia ogni chiamata concorrente apriva la propria connessione allo
 * stesso file — la cache nativa di expo-sqlite ne sfrattava una in corsa e
 * `prepareAsync` esplodeva con un NullPointerException intermittente. Con la
 * promessa come guardia la connessione è una per costruzione; se l'apertura
 * fallisce si molla la presa, così il giro dopo riprova da zero.
 */
let database: Promise<SQLite.SQLiteDatabase> | null = null;

function db(): Promise<SQLite.SQLiteDatabase> {
  if (!database) {
    database = openWallet().catch((error) => {
      database = null;
      throw error;
    });
  }
  return database;
}

async function openWallet(): Promise<SQLite.SQLiteDatabase> {
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

    -- Le sessioni di presenza: aperte all'ingresso nella region del beacon,
    -- chiuse all'uscita. Sono l'equivalente del disconnect che un beacon
    -- non-connettibile non può darci, e servono a non contare come permanenza
    -- il tempo passato altrove.
    CREATE TABLE IF NOT EXISTS presence_sessions (
      event_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      PRIMARY KEY (event_id, started_at)
    );

    -- Telemetria: perché il telefono ha taciuto. Non prova niente e non
    -- entra nella verifica — serve a distinguere «dormiva» da «se n'era
    -- andato» quando si guarda un buco nella timeline. Bufferizzata come i
    -- codici, così sopravvive all'offline.
    CREATE TABLE IF NOT EXISTS device_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL,
      at TEXT NOT NULL,
      kind TEXT NOT NULL,
      detail TEXT,
      sent_at TEXT
    );

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
  // Sentire un codice è già prova di presenza: se nessuna sessione è aperta
  // — ingresso nella region perso, o rientro senza risveglio — se ne apre una
  // qui. Senza questa rete di sicurezza un codice orfano varrebbe un istante
  // invece di un intervallo.
  await openPresenceSession(eventId, collectedAt);

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

/* --------------------------------------------------- sessioni di presenza */

/**
 * Ingresso nella region: apre una sessione, se non ce n'è già una aperta.
 * iOS rivaluta lo stato della region a ogni accensione dello schermo e può
 * emettere più ingressi di fila — riaprire azzererebbe la sessione in corso.
 */
export async function openPresenceSession(
  eventId: string,
  at: Date = new Date(),
): Promise<void> {
  const open = await (
    await db()
  ).getFirstAsync<{ started_at: string }>(
    "SELECT started_at FROM presence_sessions WHERE event_id = ? AND ended_at IS NULL",
    eventId,
  );
  if (open) return;
  await (
    await db()
  ).runAsync(
    "INSERT OR IGNORE INTO presence_sessions (event_id, started_at) VALUES (?, ?)",
    eventId,
    at.toISOString(),
  );
}

/** Uscita dalla region: chiude la sessione aperta. Rientrare ne apre un'altra. */
export async function closePresenceSession(
  eventId: string,
  at: Date = new Date(),
): Promise<void> {
  await (
    await db()
  ).runAsync(
    "UPDATE presence_sessions SET ended_at = ? WHERE event_id = ? AND ended_at IS NULL",
    at.toISOString(),
    eventId,
  );
}

/**
 * Annota un fatto osservato dal telefono.
 *
 * Deliberatamente a prova di errore: la telemetria non deve mai poter far
 * fallire il giro che la produce. Se scrivere non riesce, si perde una riga
 * di log — non un codice.
 */
export async function logDeviceEvent(
  eventId: string,
  kind: string,
  detail?: string,
  at: Date = new Date(),
): Promise<void> {
  try {
    await (
      await db()
    ).runAsync(
      "INSERT INTO device_events (event_id, at, kind, detail) VALUES (?, ?, ?, ?)",
      eventId,
      at.toISOString(),
      kind,
      detail ?? null,
    );
  } catch {
    /* la diagnostica non è mai un motivo per rompere il flusso */
  }
}

/**
 * Spedisce le righe non ancora consegnate. Separata da `flush`: i risvegli
 * più interessanti da raccontare sono quelli senza codici da consegnare.
 */
export async function flushTelemetry(
  eventId: string,
  deviceId: string,
): Promise<number> {
  const rows = await (
    await db()
  ).getAllAsync<{ id: number; at: string; kind: string; detail: string | null }>(
    "SELECT id, at, kind, detail FROM device_events WHERE event_id = ? AND sent_at IS NULL ORDER BY at LIMIT 500",
    eventId,
  );
  if (rows.length === 0) return 0;

  const sent = await postTelemetry(eventId, {
    deviceId,
    events: rows.map((r) => ({
      at: r.at,
      kind: r.kind,
      ...(r.detail ? { detail: r.detail } : {}),
    })),
  });
  if (!sent) return 0;

  const placeholders = rows.map(() => "?").join(",");
  await (
    await db()
  ).runAsync(
    `UPDATE device_events SET sent_at = ? WHERE id IN (${placeholders})`,
    new Date().toISOString(),
    ...rows.map((r) => r.id),
  );
  return rows.length;
}

export async function presenceSessions(
  eventId: string,
): Promise<{ startedAt: string; endedAt?: string }[]> {
  const rows = await (
    await db()
  ).getAllAsync<{ started_at: string; ended_at: string | null }>(
    "SELECT started_at, ended_at FROM presence_sessions WHERE event_id = ? ORDER BY started_at",
    eventId,
  );
  return rows.map((r) => ({
    startedAt: r.started_at,
    ...(r.ended_at ? { endedAt: r.ended_at } : {}),
  }));
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
    // Le sessioni non sono item di borsellino: non si consumano, si
    // rispediscono intere a ogni consegna e il server le unisce.
    const sessions = await presenceSessions(delivery.eventId);
    if (sessions.length > 0) delivery.payload.sessions = sessions;

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
