/** Identità del device dell'attendee, stabile in localStorage. */
export function getDeviceId(): string {
  let id = localStorage.getItem("device-id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("device-id", id);
  }
  return id;
}

export function getAttendeeName(): string {
  return localStorage.getItem("attendee-name") ?? "";
}

export function setAttendeeName(name: string): void {
  localStorage.setItem("attendee-name", name);
}
