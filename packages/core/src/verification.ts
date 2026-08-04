import { CODE_WINDOW_MS, deriveRotatingCode } from "./rotating-code.js";

export interface EventWindow {
  id: string;
  seed: string;
  startsAt: Date;
  endsAt: Date;
}

export interface CollectedCode {
  value: string;
  collectedAt: Date;
}

export interface Delivery {
  event: EventWindow;
  deviceId: string;
  codes: CollectedCode[];
  /** Contesto, mai prova: informa la UX (Arrivo), non la provenienza. */
  gps?: { insideGeofence: boolean };
  /** Testimonianza umana: l'host ha verificato la persona di fronte a sé. */
  hostAttested?: boolean;
  /** L'attendee ha toccato la notifica one-tap. Arricchisce, non crea. */
  confirmationTap?: boolean;
  deliveredAt: Date;
}

/**
 * Chi conferma la presenza. 'machine' prova il device, 'human' la persona:
 * non sono ordinate — il caso più forte le ha entrambe (vedi CONTEXT.md).
 */
export type Provenance = "machine" | "human" | "machine+human" | "none";

export interface VerificationConfig {
  /** Quanto può arrivare tardi una consegna rispetto alla raccolta dei codici. */
  maxDeliveryDelayMs: number;
}

export const DEFAULT_CONFIG: VerificationConfig = {
  maxDeliveryDelayMs: 6 * 60 * 60 * 1000,
};

export interface Quality {
  /** Codici validi distinti (una finestra = un codice). */
  validCodes: number;
  /** Arco di tempo coperto dai codici validi: il dwell opportunistico. */
  coverageMinutes: number;
  /** Tap sulla notifica one-tap: segnale di coerenza, mai di provenienza. */
  tappedNotification: boolean;
}

export interface CheckIn {
  eventId: string;
  deviceId: string;
  accredited: boolean;
  provenance: Provenance;
  quality: Quality;
}

/**
 * La cucitura di verifica (vedi docs/spec.md): consegna di codici →
 * check-in etichettato. Il server ricalcola i codici attesi dal seme
 * dell'evento e confronta finestra per finestra.
 */
function matchesWindow(seed: string, code: CollectedCode): boolean {
  // Finestra corrente più le adiacenti: skew d'orologio tra beacon e telefono.
  return [-CODE_WINDOW_MS, 0, CODE_WINDOW_MS].some(
    (shift) =>
      code.value ===
      deriveRotatingCode(seed, new Date(code.collectedAt.getTime() + shift)),
  );
}

export function evaluateDelivery(
  delivery: Delivery,
  config: VerificationConfig = DEFAULT_CONFIG,
): CheckIn {
  const validByValue = new Map<string, CollectedCode>();
  for (const code of delivery.codes) {
    if (
      matchesWindow(delivery.event.seed, code) &&
      delivery.deliveredAt.getTime() - code.collectedAt.getTime() <=
        config.maxDeliveryDelayMs
    ) {
      validByValue.set(code.value, code);
    }
  }
  const validCodes = [...validByValue.values()];

  const machineWitnessed = validCodes.length > 0;
  const humanWitnessed = delivery.hostAttested === true;
  const collectedTimes = validCodes.map((c) => c.collectedAt.getTime());
  const coverageMinutes = machineWitnessed
    ? Math.round(
        (Math.max(...collectedTimes) - Math.min(...collectedTimes)) / 60_000,
      )
    : 0;

  const provenance: Provenance =
    machineWitnessed && humanWitnessed
      ? "machine+human"
      : machineWitnessed
        ? "machine"
        : humanWitnessed
          ? "human"
          : "none";

  return {
    eventId: delivery.event.id,
    deviceId: delivery.deviceId,
    accredited: machineWitnessed || humanWitnessed,
    provenance,
    quality: {
      validCodes: validCodes.length,
      coverageMinutes,
      tappedNotification: delivery.confirmationTap === true,
    },
  };
}
