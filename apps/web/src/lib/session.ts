/** Stable anonymous session id per device. No accounts: emergencies don't have time for login. */
export function getSessionId(): string {
  const KEY = 'beacon.sessionId';
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return 'ephemeral-' + Math.random().toString(36).slice(2);
  }
}

export const EMERGENCY_NUMBER = (import.meta.env.VITE_EMERGENCY_NUMBER as string | undefined) || '911';
