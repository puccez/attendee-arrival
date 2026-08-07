import { useCallback, useEffect, useRef, useState } from "react";

import {
  WemeetBeacon,
  type NativeSighting,
  type ScanStats,
} from "../../modules/wemeet-beacon";
import { BEACON_LOST_AFTER_MS, BEACON_UUID } from "../lib/config";
import { collectCode } from "../wallet/wallet";
import { normalizeSighting, type Sighting } from "./normalize";

/**
 * Il canale radio, visto dall'app.
 *
 * Il telefono ascolta e basta: non deriva niente, non emette niente, non sa
 * se un codice è valido — quello lo decide il server. Qui si raccoglie e si
 * mette nel borsellino.
 */

export interface BeaconChannel {
  /** Il modulo nativo è presente in questa build? */
  available: boolean;
  listening: boolean;
  /** Il beacon si sente adesso. */
  inRange: boolean;
  lastSighting: Sighting | null;
  /** Ultimo Codice Rotante sentito in onda. */
  lastCode: string | null;
  /** Codici distinti raccolti in questa sessione di ascolto. */
  collectedNow: number;
  error: string | null;
  /** La radiografia della scansione (solo Android): dove si ferma il segnale. */
  stats: ScanStats | null;
}

const INITIAL: BeaconChannel = {
  available: WemeetBeacon != null,
  listening: false,
  inRange: false,
  lastSighting: null,
  lastCode: null,
  collectedNow: 0,
  error: null,
  stats: null,
};

export function useBeaconChannel(
  eventId: string | null,
  onCodeCollected?: (code: string) => void,
): BeaconChannel & { restart: () => void } {
  const [state, setState] = useState<BeaconChannel>(INITIAL);
  const [attempt, setAttempt] = useState(0);
  const lastSeenAt = useRef<number>(0);
  const collectedCodes = useRef<Set<string>>(new Set());

  const restart = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!eventId || !WemeetBeacon) return;
    let cancelled = false;
    collectedCodes.current = new Set();

    const subscription = WemeetBeacon.addListener(
      "onBeaconRanged",
      ({ beacons }: { beacons: NativeSighting[] }) => {
        void (async () => {
          for (const raw of beacons) {
            const sighting = normalizeSighting(raw, BEACON_UUID);
            if (!sighting) continue;

            lastSeenAt.current = Date.now();
            setState((prev) => ({
              ...prev,
              inRange: true,
              lastSighting: sighting,
              lastCode: sighting.code ?? prev.lastCode,
              error: null,
            }));

            if (!sighting.code) continue;
            if (collectedCodes.current.has(sighting.code)) continue;
            collectedCodes.current.add(sighting.code);

            // Il borsellino sa già ignorare i duplicati fra sessioni.
            const isNew = await collectCode(eventId, sighting.code, sighting.at);
            if (!isNew || cancelled) continue;
            setState((prev) => ({
              ...prev,
              collectedNow: prev.collectedNow + 1,
            }));
            onCodeCollected?.(sighting.code);
          }
        })();
      },
    );

    WemeetBeacon.startRangingAsync(BEACON_UUID)
      .then(() => {
        if (!cancelled) setState((prev) => ({ ...prev, listening: true, error: null }));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          listening: false,
          error: error instanceof Error ? error.message : String(error),
        }));
      });

    // Il beacon non annuncia la propria assenza: il silenzio si misura.
    const silenceTimer = setInterval(() => {
      if (Date.now() - lastSeenAt.current > BEACON_LOST_AFTER_MS) {
        setState((prev) => (prev.inRange ? { ...prev, inRange: false } : prev));
      }
      // La radiografia si aggiorna insieme: dove si ferma il segnale?
      WemeetBeacon?.scanStatsAsync?.()
        .then((stats) => {
          if (cancelled) return;
          setState((prev) => ({ ...prev, stats: stats.supported ? stats : null }));
        })
        .catch(() => {});
    }, 5_000);

    return () => {
      cancelled = true;
      clearInterval(silenceTimer);
      subscription.remove();
      WemeetBeacon?.stopRangingAsync().catch(() => {});
    };
  }, [eventId, attempt, onCodeCollected]);

  return { ...state, restart };
}
