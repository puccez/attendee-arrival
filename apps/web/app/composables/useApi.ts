export function useApi() {
  const base = useRuntimeConfig().public.apiBase;
  return {
    post: <T>(path: string, body: unknown) =>
      $fetch<T>(`${base}${path}`, { method: "POST", body }),
    get: <T>(path: string) => $fetch<T>(`${base}${path}`),
  };
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
    tappedNotification: boolean;
  };
  updatedAt: string;
}
