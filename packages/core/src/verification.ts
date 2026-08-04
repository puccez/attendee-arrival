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
 * Non è una prova e non va creduta sulla parola: **taglia soltanto**. Un
 * intervallo fra due codici che cade a cavallo di un'uscita non si accredita;
 * per il resto la copertura la decidono i codici e il tetto di
 * `maxCreditedGapMs`. Da cui le due proprietà che rendono sicuro accettarle
 * da un client non fidato: dichiarare una sessione lunga un'ora non allunga
 * la copertura di un minuto, e non dichiarare niente non la allunga nemmeno.
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
  /**
   * Quanto si accredita al massimo nell'intervallo fra due codici consecutivi.
   * È il tetto che rende la copertura un limite *inferiore*: si accredita il
   * tempo intorno a ciò che si è campionato, non il tempo che si immagina in
   * mezzo. Senza tetto, chi esce e rientra si farebbe accreditare l'assenza
   * semplicemente non dichiarando la sessione (vedi PresenceSession).
   */
  maxCreditedGapMs: number;
}

export const DEFAULT_CONFIG: VerificationConfig = {
  maxDeliveryDelayMs: 6 * 60 * 60 * 1000,
  maxCreditedGapMs: 10 * 60 * 1000,
};

export interface Quality {
  /** Codici validi distinti (una finestra = un codice). */
  validCodes: number;
  /**
   * Il tempo campionato al venue: la somma degli intervalli fra codici
   * validi consecutivi, ciascuno accreditato fino al tetto di
   * `maxCreditedGapMs`. Un limite *inferiore* per costruzione — si accredita
   * il tempo intorno a ciò che si è sentito, mai il tempo che si immagina in
   * mezzo. Leggilo insieme a `longestGapMinutes`.
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

function containsInstant(session: PresenceSession, at: number): boolean {
  return (
    at >= session.startedAt.getTime() &&
    at <= (session.endedAt?.getTime() ?? Number.POSITIVE_INFINITY)
  );
}

/**
 * La copertura: quanto tempo si è davvero campionato al venue.
 *
 * Si guarda un intervallo alla volta, fra due codici validi consecutivi, e
 * lo si accredita per la sua durata — ma non oltre il tetto. Due proprietà
 * che valgono la pena di essere dette:
 *
 * 1. **Non serve credere al client.** I codici li verifica il server, e il
 *    tetto vale comunque. Un telefono che tace non guadagna niente: chi esce
 *    per un'ora si vede accreditare al massimo un tetto, dichiari o no.
 * 2. **Le sessioni possono solo tagliare.** Se due codici consecutivi non
 *    stanno nella stessa sessione dichiarata, in mezzo c'è un'uscita e
 *    l'intervallo non si accredita affatto. Dichiarare allunga la precisione,
 *    mai la copertura — che è ciò che rende sicuro accettarle da un client
 *    non fidato.
 *
 * Il numero che ne esce è un limite inferiore per costruzione: si legge
 * insieme a `longestGapMinutes`, che dice quanto è ruvido il campionamento.
 */
function coverageMinutes(
  validCodes: CollectedCode[],
  sessions: PresenceSession[] | undefined,
  maxCreditedGapMs: number,
): number {
  const times = validCodes
    .map((c) => c.collectedAt.getTime())
    .sort((a, b) => a - b);

  let credited = 0;
  for (let i = 1; i < times.length; i++) {
    const from = times[i - 1]!;
    const to = times[i]!;
    const split =
      sessions !== undefined &&
      sessions.length > 0 &&
      !sessions.some((s) => containsInstant(s, from) && containsInstant(s, to));
    if (split) continue;
    credited += Math.min(to - from, maxCreditedGapMs);
  }
  return Math.round(credited / 60_000);
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
      coverageMinutes: coverageMinutes(
        validCodes,
        delivery.sessions,
        config.maxCreditedGapMs,
      ),
      longestGapMinutes: longestGapMinutes(validCodes),
      tappedNotification: delivery.confirmationTap === true,
    },
  };
}
