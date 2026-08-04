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

/**
 * Una finestra di presenza osservata dal client: ingresso e uscita dalla
 * region del beacon. Su iOS sono `didEnterRegion`/`didExitRegion`, l'unico
 * segnale di *fine presenza* che un beacon non-connettibile ci lascia.
 *
 * Non è una prova e non va creduta sulla parola: delimita soltanto. Una
 * sessione vale i minuti dei codici validi che contiene, e quelli non si
 * inventano — dichiararla lunga un'ora non allunga la copertura di un minuto.
 */
export interface PresenceSession {
  startedAt: Date;
  /** Assente = ancora aperta al momento della consegna. */
  endedAt?: Date;
}

export interface Delivery {
  event: EventWindow;
  deviceId: string;
  codes: CollectedCode[];
  /** Le sessioni di presenza dichiarate dal client. Vedi PresenceSession. */
  sessions?: PresenceSession[];
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
  /**
   * Somma delle sessioni di presenza, ciascuna misurata dai propri codici
   * validi e unita alle altre senza contare due volte le sovrapposizioni.
   * Il tempo passato fuori — fra un'uscita e il rientro — non entra.
   *
   * Senza sessioni dichiarate degrada all'arco fra il primo e l'ultimo
   * codice: è un limite superiore, non una permanenza continua. Leggilo
   * insieme a `longestGapMinutes`.
   */
  coverageMinutes: number;
  /**
   * Il buco più lungo fra due codici consecutivi. Un attendee col telefono
   * in mano vicino al beacon raccoglie ogni 30 secondi; chi esce lascia un
   * buco grosso. Non è una prova d'assenza — in background iOS concede pochi
   * secondi di ranging per risveglio, quindi i buchi capitano anche a chi
   * resta — ma è la differenza visibile all'host.
   */
  longestGapMinutes: number;
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

/**
 * Gli intervalli che meritano di essere contati.
 *
 * Ogni sessione dichiarata vale il tratto fra il suo primo e il suo ultimo
 * codice valido: è il client a dire dove sono i confini, ma sono i codici a
 * dire quanto dura. Un codice fuori da ogni sessione resta una prova di
 * presenza (conta in `validCodes`) e vale un istante, non un intervallo.
 *
 * Senza sessioni si ricade su un'unica sessione implicita — il
 * comportamento di prima, che sopravvaluta chi esce e rientra.
 */
function creditedIntervals(
  validCodes: CollectedCode[],
  sessions: PresenceSession[] | undefined,
): Array<[number, number]> {
  const times = validCodes
    .map((c) => c.collectedAt.getTime())
    .sort((a, b) => a - b);
  if (times.length === 0) return [];
  if (!sessions || sessions.length === 0) {
    return [[times[0]!, times[times.length - 1]!]];
  }

  const intervals: Array<[number, number]> = [];
  const credited = new Set<number>();
  for (const session of sessions) {
    const from = session.startedAt.getTime();
    const to = session.endedAt?.getTime() ?? Number.POSITIVE_INFINITY;
    const inside = times.filter((t) => t >= from && t <= to);
    if (inside.length === 0) continue;
    for (const t of inside) credited.add(t);
    intervals.push([inside[0]!, inside[inside.length - 1]!]);
  }
  for (const t of times) if (!credited.has(t)) intervals.push([t, t]);
  return intervals;
}

/** Unione di intervalli: le sovrapposizioni non si contano due volte. */
function unionMinutes(intervals: Array<[number, number]>): number {
  if (intervals.length === 0) return 0;
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  let [start, end] = sorted[0]!;
  let total = 0;
  for (const [s, e] of sorted.slice(1)) {
    if (s <= end) {
      if (e > end) end = e;
    } else {
      total += end - start;
      [start, end] = [s, e];
    }
  }
  return Math.round((total + (end - start)) / 60_000);
}

function longestGapMinutes(validCodes: CollectedCode[]): number {
  const times = validCodes
    .map((c) => c.collectedAt.getTime())
    .sort((a, b) => a - b);
  let longest = 0;
  for (let i = 1; i < times.length; i++) {
    longest = Math.max(longest, times[i]! - times[i - 1]!);
  }
  return Math.round(longest / 60_000);
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
  const coverageMinutes = unionMinutes(
    creditedIntervals(validCodes, delivery.sessions),
  );

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
      longestGapMinutes: longestGapMinutes(validCodes),
      tappedNotification: delivery.confirmationTap === true,
    },
  };
}
