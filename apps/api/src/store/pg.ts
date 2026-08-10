import pg from "pg";
import type { AttendeeCheckIn } from "../check-in/check-ins.service.js";
import type { WeMeetEvent } from "../events/events.service.js";
import type {
  AttendeeState,
  CheckInsStore,
  DeviceEvent,
  EventsStore,
  NotaryDevice,
  NotaryDevicesStore,
  NotaryDeviceStatus,
  TelemetryStore,
} from "./store.js";

/**
 * Store su Postgres (nella demo: Supabase; in produzione: qualunque
 * Postgres — vedi docs/spec.md). Connessione pooled (Supavisor).
 */
export class PgClient {
  readonly pool: pg.Pool;
  private ready: Promise<void> | null = null;

  constructor(connectionString: string) {
    // sslmode nella URL prevale sull'opzione ssl del driver: lo rimuoviamo
    // e gestiamo il TLS esplicitamente (il pooler Supabase usa cert propri).
    const url = new URL(connectionString);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    url.searchParams.delete("sslmode");
    this.pool = new pg.Pool({
      connectionString: url.toString(),
      max: 3,
      ssl: local ? undefined : { rejectUnauthorized: false },
    });
  }

  /** Bootstrap dello schema, una volta per processo. */
  ensureSchema(): Promise<void> {
    this.ready ??= this.pool
      .query(
        `CREATE TABLE IF NOT EXISTS events (
           id uuid PRIMARY KEY,
           name text NOT NULL,
           seed text NOT NULL,
           starts_at timestamptz NOT NULL,
           ends_at timestamptz NOT NULL,
           geofence jsonb
         );
         CREATE TABLE IF NOT EXISTS check_ins (
           event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
           device_id text NOT NULL,
           attendee_name text,
           codes jsonb NOT NULL DEFAULT '[]',
           host_attested boolean NOT NULL DEFAULT false,
           confirmation_tap boolean NOT NULL DEFAULT false,
           gps_inside boolean NOT NULL DEFAULT false,
           result jsonb,
           updated_at timestamptz NOT NULL,
           PRIMARY KEY (event_id, device_id)
         );
         -- Le tabelle create prima delle sessioni di presenza non hanno la
         -- colonna: CREATE TABLE IF NOT EXISTS non la aggiungerebbe mai.
         ALTER TABLE check_ins
           ADD COLUMN IF NOT EXISTS sessions jsonb NOT NULL DEFAULT '[]';
         -- Telemetria: fuori dalla cucitura di verifica, e in tabella a parte
         -- perché il volume è di un altro ordine e non deve appesantire la
         -- riga che si legge a ogni consegna.
         CREATE TABLE IF NOT EXISTS device_events (
           event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
           device_id text NOT NULL,
           at timestamptz NOT NULL,
           kind text NOT NULL,
           detail text,
           PRIMARY KEY (event_id, device_id, at, kind)
         );
         -- I beacon fissi: hardware, non dati dell'evento. Niente vincolo
         -- referenziale di proposito — l'evento che muore LIBERA il beacon
         -- (event_id a NULL nella transazione di delete), non lo cancella.
         CREATE TABLE IF NOT EXISTS notary_devices (
           device_id text PRIMARY KEY,
           last_seen_at timestamptz,
           event_id uuid,
           status jsonb
         );`,
      )
      .then(() => undefined);
    return this.ready;
  }
}

export class PgEventsStore implements EventsStore {
  constructor(private readonly db: PgClient) {}

  async create(event: WeMeetEvent): Promise<void> {
    await this.db.ensureSchema();
    await this.db.pool.query(
      `INSERT INTO events (id, name, seed, starts_at, ends_at, geofence)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        event.id,
        event.name,
        event.seed,
        event.startsAt,
        event.endsAt,
        event.geofence ?? null,
      ],
    );
  }

  async get(id: string): Promise<WeMeetEvent | null> {
    await this.db.ensureSchema();
    const { rows } = await this.db.pool.query(
      `SELECT id, name, seed, starts_at, ends_at, geofence FROM events WHERE id = $1`,
      [id],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      seed: r.seed,
      startsAt: new Date(r.starts_at),
      endsAt: new Date(r.ends_at),
      geofence: r.geofence ?? undefined,
    };
  }

  async list(limit: number): Promise<WeMeetEvent[]> {
    await this.db.ensureSchema();
    const { rows } = await this.db.pool.query(
      `SELECT id, name, seed, starts_at, ends_at, geofence
       FROM events ORDER BY starts_at DESC LIMIT $1`,
      [limit],
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      seed: r.seed,
      startsAt: new Date(r.starts_at),
      endsAt: new Date(r.ends_at),
      geofence: r.geofence ?? undefined,
    }));
  }

  async delete(id: string): Promise<boolean> {
    await this.db.ensureSchema();
    // I vincoli dicono ON DELETE CASCADE e per uno schema nato oggi
    // basterebbe il DELETE sull'evento; ma CREATE TABLE IF NOT EXISTS non
    // ritocca mai una tabella nata da uno schema più vecchio (è la stessa
    // trappola della colonna sessions, più su), quindi le righe collegate
    // si cancellano per nome — e in transazione, perché un evento sparito
    // a metà lascerebbe telemetria orfana che nessuno saprebbe più leggere.
    const client = await this.db.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM device_events WHERE event_id = $1`, [id]);
      await client.query(`DELETE FROM check_ins WHERE event_id = $1`, [id]);
      // Il beacon fisso sopravvive al suo evento: torna libero, e al
      // prossimo battito il server gli risponderà proprio così.
      await client.query(
        `UPDATE notary_devices SET event_id = NULL WHERE event_id = $1`,
        [id],
      );
      const res = await client.query(`DELETE FROM events WHERE id = $1`, [id]);
      await client.query("COMMIT");
      return (res.rowCount ?? 0) > 0;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}

export class PgNotaryDevicesStore implements NotaryDevicesStore {
  constructor(private readonly db: PgClient) {}

  async heartbeat(
    deviceId: string,
    status: NotaryDeviceStatus,
    at: Date,
  ): Promise<string | null> {
    await this.db.ensureSchema();
    const { rows } = await this.db.pool.query(
      `INSERT INTO notary_devices (device_id, last_seen_at, status)
       VALUES ($1, $2, $3)
       ON CONFLICT (device_id) DO UPDATE SET
         last_seen_at = EXCLUDED.last_seen_at,
         status = EXCLUDED.status
       RETURNING event_id`,
      [deviceId, at, JSON.stringify(status)],
    );
    return rows[0]?.event_id ?? null;
  }

  async list(): Promise<NotaryDevice[]> {
    await this.db.ensureSchema();
    const { rows } = await this.db.pool.query(
      `SELECT device_id, last_seen_at, event_id, status
       FROM notary_devices ORDER BY last_seen_at DESC NULLS LAST`,
    );
    return rows.map((r) => ({
      deviceId: r.device_id,
      lastSeenAt: r.last_seen_at ? new Date(r.last_seen_at) : null,
      eventId: r.event_id ?? null,
      status: r.status ?? null,
    }));
  }

  async assign(deviceId: string, eventId: string): Promise<void> {
    await this.db.ensureSchema();
    await this.db.pool.query(
      `INSERT INTO notary_devices (device_id, event_id)
       VALUES ($1, $2)
       ON CONFLICT (device_id) DO UPDATE SET event_id = EXCLUDED.event_id`,
      [deviceId, eventId],
    );
  }

  async unassign(deviceId: string): Promise<boolean> {
    await this.db.ensureSchema();
    const res = await this.db.pool.query(
      `UPDATE notary_devices SET event_id = NULL WHERE device_id = $1`,
      [deviceId],
    );
    return (res.rowCount ?? 0) > 0;
  }
}

export class PgTelemetryStore implements TelemetryStore {
  constructor(private readonly db: PgClient) {}

  async append(
    eventId: string,
    deviceId: string,
    events: DeviceEvent[],
  ): Promise<void> {
    if (events.length === 0) return;
    await this.db.ensureSchema();
    // Il device rispedisce volentieri: la chiave primaria assorbe i doppioni.
    const values = events
      .map((_, i) => `($1, $2, $${i * 3 + 3}, $${i * 3 + 4}, $${i * 3 + 5})`)
      .join(",");
    await this.db.pool.query(
      `INSERT INTO device_events (event_id, device_id, at, kind, detail)
       VALUES ${values} ON CONFLICT DO NOTHING`,
      [
        eventId,
        deviceId,
        ...events.flatMap((e) => [e.at, e.kind, e.detail ?? null]),
      ],
    );
  }
}

export class PgCheckInsStore implements CheckInsStore {
  constructor(private readonly db: PgClient) {}

  async load(eventId: string, deviceId: string): Promise<AttendeeState | null> {
    await this.db.ensureSchema();
    const { rows } = await this.db.pool.query(
      `SELECT attendee_name, codes, sessions, host_attested, confirmation_tap,
              gps_inside
       FROM check_ins WHERE event_id = $1 AND device_id = $2`,
      [eventId, deviceId],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      attendeeName: r.attendee_name ?? undefined,
      codes: (
        r.codes as {
          value: string;
          collectedAt: string;
          deliveredAt?: string;
        }[]
      ).map((c) => ({
        value: c.value,
        collectedAt: new Date(c.collectedAt),
        // Assente sulle righe scritte prima del timbro d'arrivo.
        deliveredAt: c.deliveredAt ? new Date(c.deliveredAt) : undefined,
      })),
      sessions: (
        (r.sessions ?? []) as { startedAt: string; endedAt?: string }[]
      ).map((s) => ({
        startedAt: new Date(s.startedAt),
        endedAt: s.endedAt ? new Date(s.endedAt) : undefined,
      })),
      hostAttested: r.host_attested,
      confirmationTap: r.confirmation_tap,
      gpsInsideSeen: r.gps_inside,
    };
  }

  async save(
    eventId: string,
    deviceId: string,
    state: AttendeeState,
    result: AttendeeCheckIn,
  ): Promise<void> {
    await this.db.ensureSchema();
    await this.db.pool.query(
      `INSERT INTO check_ins
         (event_id, device_id, attendee_name, codes, sessions, host_attested,
          confirmation_tap, gps_inside, result, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (event_id, device_id) DO UPDATE SET
         attendee_name = EXCLUDED.attendee_name,
         codes = EXCLUDED.codes,
         sessions = EXCLUDED.sessions,
         host_attested = EXCLUDED.host_attested,
         confirmation_tap = EXCLUDED.confirmation_tap,
         gps_inside = EXCLUDED.gps_inside,
         result = EXCLUDED.result,
         updated_at = EXCLUDED.updated_at`,
      [
        eventId,
        deviceId,
        state.attendeeName ?? null,
        JSON.stringify(state.codes),
        JSON.stringify(state.sessions),
        state.hostAttested,
        state.confirmationTap,
        state.gpsInsideSeen,
        JSON.stringify(result),
        result.updatedAt,
      ],
    );
  }

  async list(eventId: string): Promise<AttendeeCheckIn[]> {
    await this.db.ensureSchema();
    const { rows } = await this.db.pool.query(
      `SELECT result FROM check_ins WHERE event_id = $1 ORDER BY updated_at DESC`,
      [eventId],
    );
    return rows.map((r) => r.result as AttendeeCheckIn);
  }
}
