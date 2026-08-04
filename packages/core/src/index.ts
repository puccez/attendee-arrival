// @attendee-arrival/core — dominio condiviso del check-in WeMeet.
// Vocabolario: vedi CONTEXT.md alla radice del repo.
export { CODE_WINDOW_MS, deriveRotatingCode, windowIndex } from "./rotating-code.js";
export { DEFAULT_CONFIG, evaluateDelivery } from "./verification.js";
export type {
  CheckIn,
  CollectedCode,
  Delivery,
  EventWindow,
  PresenceSession,
  Provenance,
  Quality,
  VerificationConfig,
} from "./verification.js";
