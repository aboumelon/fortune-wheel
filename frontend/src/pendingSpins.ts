const PENDING_KEY_PREFIX = "fortune-wheel:pending-spin:";
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function userKey(userId: number) {
  return `${PENDING_KEY_PREFIX}${userId}`;
}

function requestKey(userId: number, requestId: string) {
  return `${userKey(userId)}:${requestId}`;
}

export function readPendingRequest(userId: number): string | null {
  const legacyKey = userKey(userId);
  const legacyRequestId = window.localStorage.getItem(legacyKey);
  if (legacyRequestId) {
    if (REQUEST_ID_PATTERN.test(legacyRequestId)) {
      const key = requestKey(userId, legacyRequestId);
      if (window.localStorage.getItem(key) === null) {
        window.localStorage.setItem(key, String(Date.now()));
      }
    }
    if (window.localStorage.getItem(legacyKey) === legacyRequestId) {
      window.localStorage.removeItem(legacyKey);
    }
  }

  const prefix = `${userKey(userId)}:`;
  const pending: { requestId: string; savedAt: number }[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key?.startsWith(prefix)) continue;
    const requestId = key.slice(prefix.length);
    if (!REQUEST_ID_PATTERN.test(requestId)) continue;
    const savedAt = Number(window.localStorage.getItem(key));
    pending.push({ requestId, savedAt: Number.isFinite(savedAt) ? savedAt : 0 });
  }

  // Prefer this tab's attempt; other unacknowledged attempts remain recoverable.
  const tabRequestId = window.sessionStorage.getItem(userKey(userId));
  if (pending.some((item) => item.requestId === tabRequestId)) return tabRequestId;
  pending.sort((a, b) => a.savedAt - b.savedAt || a.requestId.localeCompare(b.requestId));
  return pending[0]?.requestId ?? null;
}

export function savePendingRequest(userId: number, requestId: string) {
  window.localStorage.setItem(requestKey(userId, requestId), String(Date.now()));
  window.sessionStorage.setItem(userKey(userId), requestId);
}

export function clearPendingRequest(userId: number, requestId: string) {
  window.localStorage.removeItem(requestKey(userId, requestId));
  const key = userKey(userId);
  if (window.localStorage.getItem(key) === requestId) window.localStorage.removeItem(key);
  if (window.sessionStorage.getItem(key) === requestId) window.sessionStorage.removeItem(key);
}
