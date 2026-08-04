import Constants from "expo-constants";

interface Extra {
  apiBase?: string;
  beaconUuid?: string;
}

const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

/** La cucitura di verifica: l'unica porta verso cui il borsellino scrive. */
export const API_BASE =
  extra.apiBase ?? "https://attendee-arrival-api.vercel.app";

/**
 * L'UUID di prossimità del beacon-notaio: l'identità FISSA su cui iOS
 * registra la region e sveglia l'app. Deve combaciare con quello del
 * firmware (firmware/attendee_beacon/config.h).
 */
export const BEACON_UUID =
  extra.beaconUuid ?? "B6C60396-4B64-44D6-84E7-54909270550C";

/**
 * Quanto silenzio radio serve per considerare finita la permanenza.
 * Non è campionamento continuo: è dwell opportunistico (vedi CONTEXT.md).
 */
export const BEACON_LOST_AFTER_MS = 45_000;

/** Ogni quanto tentare di svuotare il borsellino quando l'app è aperta. */
export const FLUSH_INTERVAL_MS = 20_000;
