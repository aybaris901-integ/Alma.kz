const GUEST_SESSION_KEY = "guestSessionId";

export function getGuestSessionId(): string {
  let guestSessionId = localStorage.getItem(GUEST_SESSION_KEY);

  if (!guestSessionId) {
    guestSessionId = crypto.randomUUID();
    localStorage.setItem(GUEST_SESSION_KEY, guestSessionId);
  }

  return guestSessionId;
}