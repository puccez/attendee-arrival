import { API_BASE } from "./config";
import type { DeliveryPayload } from "./delivery";

/**
 * Client dell'API di verifica. Sottile per costruzione: tutta la logica di
 * fiducia vive dietro questa porta, sul server. Il client non decide niente
 * — raccoglie e consegna (vedi docs/spec.md).
 *
 * I tipi rispecchiano @attendee-arrival/core (packages/core/src/verification.ts):
 * sono duplicati qui e non importati perché l'app Expo sta fuori dal
 * workspace pnpm (vedi README.md).
 */

export type Provenance = "machine" | "human" | "machine+human" | "none";

export interface Quality {
  /** Codici validi distinti: una finestra di 30 s = un codice. */
  validCodes: number;
  /**
   * Il tempo campionato al venue: gli intervalli fra codici consecutivi,
   * ciascuno accreditato fino a un tetto. Limite inferiore per costruzione.
   */
  coverageMinutes: number;
  /** Il buco più lungo fra due codici: rende visibile chi esce e rientra. */
  longestGapMinutes: number;
  /**
   * Quanto era vecchia la prova più vecchia quando è arrivata al server: chi
   * è al venue consegna in diretta, una prova inoltrata porta il suo ritardo.
   */
  deliveryLagMinutes: number;
  /** Tap sulla notifica one-tap: arricchisce la qualità, mai la provenienza. */
  tappedNotification: boolean;
}

export interface ApiCheckIn {
  eventId: string;
  deviceId: string;
  accredited: boolean;
  provenance: Provenance;
  quality: Quality;
  attendeeName?: string;
  updatedAt: string;
}

export interface ApiEvent {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  geofence?: { lat: number; lng: number; radiusM: number };
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);
  if (!response.ok) {
    throw new ApiError(
      `${init?.method ?? "GET"} ${path}: HTTP ${response.status}`,
      response.status,
    );
  }
  return (await response.json()) as T;
}

export function fetchEvent(eventId: string): Promise<ApiEvent> {
  return request<ApiEvent>(`/events/${eventId}`);
}

/** Gli eventi recenti: la lista da toccare al posto dell'id incollato. */
export function fetchEvents(): Promise<ApiEvent[]> {
  return request<ApiEvent[]>("/events");
}

export interface CreateEventInput {
  name: string;
  startsAt: string;
  endsAt: string;
  geofence?: { lat: number; lng: number; radiusM: number };
}

/**
 * La nascita di un evento dal telefono: chi conduce lo crea sul posto,
 * senza passare dalla console. Il server genera id e seme — il seme,
 * come sempre, non torna indietro da questa porta.
 */
export function createEvent(input: CreateEventInput): Promise<ApiEvent> {
  return request<ApiEvent>("/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

/**
 * Gli arrivi dell'evento, per il telefono che conduce: la stessa lista
 * della console web. Si interroga a polling — è una schermata da tenere
 * aperta sul tavolo, non un canale push.
 */
export function fetchCheckIns(eventId: string): Promise<ApiCheckIn[]> {
  return request<ApiCheckIn[]>(`/events/${eventId}/check-ins`);
}

/**
 * Il codice corrente secondo il server. Serve solo alla diagnostica della
 * demo ("il beacon sta emettendo il codice giusto?"): l'app non ne ha
 * bisogno per funzionare — non deriva niente, ascolta e basta.
 */
export function fetchCurrentCode(
  eventId: string,
): Promise<{ code: string; at: string }> {
  return request(`/events/${eventId}/code`);
}

/**
 * La porta del seme: la interroga solo la modalità notaio, una volta per
 * evento, e da lì in poi deriva in locale. Il seme non entra MAI nel
 * borsellino né nella telemetria — vive nelle impostazioni del notaio e
 * viene cancellato quando l'incarico finisce (src/notary).
 */
export function fetchEventSeed(eventId: string): Promise<{ seed: string }> {
  return request(`/events/${eventId}/seed`);
}

export interface TelemetryPayload {
  deviceId: string;
  events: { at: string; kind: string; detail?: string }[];
}

/**
 * Telemetria: cosa ha fatto il telefono. Non tocca la cucitura di verifica —
 * un fallimento qui non deve avere conseguenze, quindi si limita a dire se
 * la riga è partita e non solleva mai.
 */
export async function postTelemetry(
  eventId: string,
  payload: TelemetryPayload,
): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/events/${eventId}/telemetry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    // Un 4xx è definitivo: la riga è malformata, inutile ritentare per sempre.
    return response.ok || (response.status >= 400 && response.status < 500);
  } catch {
    return false; // offline: si ritenta al prossimo giro
  }
}

/** La cucitura: consegna del borsellino → check-in etichettato. */
export async function postDelivery(
  eventId: string,
  payload: DeliveryPayload,
): Promise<{ status: number; checkIn: ApiCheckIn | null }> {
  const response = await fetch(`${API_BASE}/events/${eventId}/deliveries`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const checkIn = response.ok ? ((await response.json()) as ApiCheckIn) : null;
  return { status: response.status, checkIn };
}
