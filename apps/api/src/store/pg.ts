import pg from "pg";
import type { AttendeeCheckIn } from "../check-in/check-ins.service.js";
import type { WeMeetEvent } from "../events/events.service.js";
import type { AttendeeState, CheckInsStore, EventsStore } from "./store.js";

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
           ADD COLUMN IF NOT EXISTS sessions jsonb NOT NULL DEFAULT '[]';`,
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
      codes: (r.codes as { value: string; collectedAt: string }[]).map((c) => ({
        value: c.value,
        collectedAt: new Date(c.collectedAt),
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
