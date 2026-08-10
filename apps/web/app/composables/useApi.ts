export function useApi() {
  const base = useRuntimeConfig().public.apiBase;
  return {
    post: <T>(path: string, body: unknown) =>
      $fetch<T>(`${base}${path}`, { method: "POST", body }),
    get: <T>(path: string) => $fetch<T>(`${base}${path}`),
    /** Le porte distruttive rispondono 204: non c'è corpo da tipizzare. */
    del: (path: string) =>
      $fetch<void>(`${base}${path}`, { method: "DELETE" }),
    /** Gli incarichi si mettono: idempotente per natura, 204 anche lui. */
    put: (path: string, body: unknown) =>
      $fetch<void>(`${base}${path}`, { method: "PUT", body }),
  };
}

/** La riga del registro beacon: il seme non c'è, e non per dimenticanza. */
export interface ApiNotaryDevice {
  deviceId: string;
  lastSeenAt: string | null;
  status: { code?: string; clockSynced?: boolean } | null;
  event: { id: string; name: string } | null;
}

export interface ApiEvent {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  geofence?: { lat: number; lng: number; radiusM: number };
}

export interface ApiCheckIn {
  eventId: string;
  deviceId: string;
  attendeeName?: string;
  accredited: boolean;
  provenance: "machine" | "human" | "machine+human" | "none";
  quality: {
    validCodes: number;
    coverageMinutes: number;
    longestGapMinutes: number;
    /** Quanto era vecchia la prova più vecchia quando è arrivata al server. */
    deliveryLagMinutes: number;
    tappedNotification: boolean;
  };
  updatedAt: string;
}
