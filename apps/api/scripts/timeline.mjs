#!/usr/bin/env node
/**
 * Log stream di quello che è successo davvero al venue.
 *
 *   pnpm --filter @attendee-arrival/api timeline <eventId>
 *   pnpm --filter @attendee-arrival/api timeline <eventId> --watch
 *
 * Ricostruisce, device per device, la sequenza di ciò che il server ha
 * ricevuto: ogni codice con l'esito della verifica, ogni ingresso e uscita
 * dalla region, e — soprattutto — i silenzi. Un buco nella riga è la cosa
 * più informativa che c'è: dice che in quel tratto il telefono non stava
 * ascoltando, ed è la differenza fra «se n'è andato» e «dormiva».
 *
 * Legge da Postgres, non dall'API: l'API espone il giudizio, qui serve la
 * materia prima.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import pg from "pg";
import { deriveRotatingCode, CODE_WINDOW_MS } from "@attendee-arrival/core";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

const SILENCE_THRESHOLD_MS = 2 * 60 * 1000;

function loadEnv() {
  const raw = readFileSync(resolve(repoRoot, ".env.local"), "utf8");
  return Object.fromEntries(
    raw
      .split("\n")
      .filter((line) => line.includes("=") && !line.trimStart().startsWith("#"))
      .map((line) => {
        const at = line.indexOf("=");
        return [line.slice(0, at).trim(), line.slice(at + 1).replace(/^"|"$/g, "")];
      }),
  );
}

const json = (v) => (typeof v === "string" ? JSON.parse(v) : (v ?? []));
const hhmmss = (d) =>
  d.toLocaleTimeString("it-IT", { hour12: false, timeZone: "Europe/Rome" });
const minutes = (ms) => (ms / 60_000).toFixed(1);

/** Stessa tolleranza della cucitura: finestra corrente più le adiacenti. */
function codeIsValid(seed, value, collectedAt) {
  return [-CODE_WINDOW_MS, 0, CODE_WINDOW_MS].some(
    (shift) => value === deriveRotatingCode(seed, new Date(collectedAt.getTime() + shift)),
  );
}

function buildStream(event, row, telemetry) {
  const entries = [];
  for (const t of telemetry) {
    entries.push({
      at: new Date(t.at),
      kind: "telemetry",
      label: t.kind,
      detail: t.detail,
    });
  }
  for (const c of json(row.codes)) {
    const at = new Date(c.collectedAt);
    entries.push({
      at,
      kind: "code",
      valid: codeIsValid(event.seed, c.value, at),
      value: c.value,
    });
  }
  for (const s of json(row.sessions)) {
    entries.push({ at: new Date(s.startedAt), kind: "enter" });
    if (s.endedAt) entries.push({ at: new Date(s.endedAt), kind: "exit" });
  }
  return entries.sort((a, b) => a.at - b.at);
}

function render(event, row, telemetry, since) {
  const stream = buildStream(event, row, telemetry).filter((e) => !since || e.at > since);
  const lines = [];
  let previous = null;

  for (const entry of stream) {
    if (previous && entry.at - previous >= SILENCE_THRESHOLD_MS) {
      lines.push(
        `           ┊  ${minutes(entry.at - previous)} min di silenzio` +
          (entry.at - previous >= 10 * 60_000 ? "  ← oltre il tetto: non accreditati" : ""),
      );
    }
    if (entry.kind === "code") {
      lines.push(
        `  ${hhmmss(entry.at)}  ${entry.valid ? "▌" : "✗"}  codice ${entry.value}` +
          (entry.valid ? "" : "   NON VERIFICATO (orologio del beacon? seme sbagliato?)"),
      );
    } else if (entry.kind === "telemetry") {
      lines.push(
        `  ${hhmmss(entry.at)}  ·  ${entry.label}` +
          (entry.detail ? `  ${entry.detail}` : ""),
      );
    } else if (entry.kind === "enter") {
      lines.push(`  ${hhmmss(entry.at)}  ⇥  ingresso nella region — sessione aperta`);
    } else {
      lines.push(`  ${hhmmss(entry.at)}  ⇤  USCITA dalla region — sessione chiusa`);
    }
    previous = entry.at;
  }
  return { lines, last: stream.at(-1)?.at ?? since };
}

async function main() {
  const [eventId, ...flags] = process.argv.slice(2);
  if (!eventId) {
    console.error("uso: timeline <eventId> [--watch]");
    process.exit(1);
  }
  const watch = flags.includes("--watch");
  const env = loadEnv();
  const client = new pg.Client({
    connectionString: env.POSTGRES_URL_NON_POOLING.replace(/[?&]sslmode=[^&]*/g, ""),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const event = (await client.query("select * from events where id = $1", [eventId])).rows[0];
  if (!event) {
    console.error(`evento sconosciuto: ${eventId}`);
    process.exit(1);
  }

  const fence = json(event.geofence);
  console.log(`\n${event.name}  ·  ${event.id}`);
  console.log(
    `finestra: ${new Date(event.starts_at).toLocaleString("it-IT", { timeZone: "Europe/Rome" })}` +
      ` → ${new Date(event.ends_at).toLocaleString("it-IT", { timeZone: "Europe/Rome" })}` +
      (fence?.lat ? `  ·  geofence ${fence.lat},${fence.lng} r=${fence.radiusM}m` : ""),
  );

  const cursors = new Map();
  const tick = async () => {
    const { rows } = await client.query(
      "select * from check_ins where event_id = $1 order by device_id",
      [eventId],
    );
    // La tabella nasce al primo ensureSchema dell'API: finché non è
    // deployata, la timeline vale lo stesso — solo senza il "perché".
    const telemetry = await client
      .query(
        "select device_id, at, kind, detail from device_events where event_id = $1 order by at",
        [eventId],
      )
      .then((r) => r.rows)
      .catch(() => []);
    for (const row of rows) {
      const since = cursors.get(row.device_id);
      const mine = telemetry.filter((t) => t.device_id === row.device_id);
      const { lines, last } = render(event, row, mine, since);
      if (lines.length === 0) continue;
      if (!since) {
        const codes = json(row.codes).length;
        console.log(`\n── ${row.attendee_name || "(senza nome)"}  ·  ${row.device_id} ──`);
        console.log(`   ${codes} codici consegnati, ${json(row.sessions).length} sessioni\n`);
      }
      console.log(lines.join("\n"));
      cursors.set(row.device_id, last);
    }
  };

  await tick();
  if (!watch) {
    await client.end();
    return;
  }
  console.log("\n… in ascolto (Ctrl-C per uscire)\n");
  setInterval(() => void tick().catch((e) => console.error(e.message)), 5000);
}

await main();
