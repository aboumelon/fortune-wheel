import type { Prize, Session, SpinHistory, SpinResult } from "./types";

const REQUEST_TIMEOUT_MS = 10_000;

class ApiError extends Error {
  code: string;
  status: number;

  constructor(code: string, status = 0) {
    super(`API request failed: ${code}`);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPrize(value: unknown): value is Prize {
  if (!isRecord(value)) return false;
  const slot = value.slot;
  return (
    isNumber(value.id) &&
    isNumber(slot) &&
    Number.isInteger(slot) &&
    slot >= 0 &&
    slot <= 11 &&
    isString(value.name) &&
    isString(value.description) &&
    isString(value.icon) &&
    isString(value.color)
  );
}

function isHistory(value: unknown): value is SpinHistory {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isPrize(value.prize) &&
    isString(value.createdAt)
  );
}

function isSession(value: unknown): value is Session {
  return (
    isRecord(value) &&
    isRecord(value.user) &&
    isNumber(value.user.id) &&
    isString(value.user.username) &&
    isString(value.user.displayName) &&
    isNumber(value.remainingCoupons) &&
    Array.isArray(value.history) &&
    value.history.every(isHistory)
  );
}

function isSpinResult(value: unknown): value is SpinResult {
  return (
    isRecord(value) &&
    isString(value.spinId) &&
    isString(value.requestId) &&
    isPrize(value.prize) &&
    isNumber(value.remainingCoupons) &&
    isString(value.createdAt) &&
    typeof value.replayed === "boolean"
  );
}

function isPrizeCatalog(value: unknown): value is { prizes: Prize[] } {
  if (!isRecord(value) || !Array.isArray(value.prizes) || !value.prizes.every(isPrize)) {
    return false;
  }
  const slots = value.prizes.map((prize) => prize.slot).sort((a, b) => a - b);
  return slots.length === 12 && slots.every((slot, index) => slot === index);
}

function cookie(name: string): string | undefined {
  return document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.split("=")
    .slice(1)
    .join("=");
}

async function fetchWithTimeout(
  path: string,
  options: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const abortFromParent = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener("abort", abortFromParent, { once: true });

  try {
    return await fetch(path, { ...options, signal: controller.signal });
  } catch (reason) {
    if (timedOut) throw new ApiError("REQUEST_TIMEOUT");
    if (options.signal?.aborted) throw reason;
    throw new ApiError("NETWORK_ERROR");
  } finally {
    window.clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromParent);
  }
}

async function parseResponse(
  response: Response,
  validator: (value: unknown) => boolean,
): Promise<unknown> {
  const raw = await response.text();
  let data: unknown;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    throw new ApiError("PROTOCOL_ERROR", response.status);
  }

  if (!response.ok) {
    const code = isRecord(data) && isString(data.code) ? data.code : "HTTP_ERROR";
    throw new ApiError(code, response.status);
  }
  if (!validator(data)) throw new ApiError("PROTOCOL_ERROR", response.status);
  return data;
}

async function ensureCsrf(signal?: AbortSignal): Promise<string> {
  const existing = cookie("csrftoken");
  if (existing) return decodeURIComponent(existing);
  const response = await fetchWithTimeout(
    "/api/auth/csrf/",
    { credentials: "same-origin", signal },
  );
  const data = await parseResponse(
    response,
    (value) => isRecord(value) && isString(value.csrfToken),
  );
  return (data as { csrfToken: string }).csrfToken;
}

async function request<T>(
  path: string,
  validator: (value: unknown) => value is T,
  options: RequestInit = {},
): Promise<T> {
  const method = options.method?.toUpperCase() ?? "GET";
  const headers = new Headers(options.headers);
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    headers.set("X-CSRFToken", await ensureCsrf(options.signal ?? undefined));
  }
  if (options.body) headers.set("Content-Type", "application/json");

  const response = await fetchWithTimeout(path, {
    ...options,
    headers,
    credentials: "same-origin",
  });
  return (await parseResponse(response, validator)) as T;
}

const isOk = (value: unknown): value is { ok: boolean } =>
  isRecord(value) && typeof value.ok === "boolean";

export const api = {
  csrf: (signal?: AbortSignal) => ensureCsrf(signal),
  session: (signal?: AbortSignal) =>
    request<Session>("/api/auth/me/", isSession, { signal }),
  prizes: async (signal?: AbortSignal) => {
    try {
      const payload = await request<{ prizes: Prize[] }>(
        "/api/prizes/",
        isPrizeCatalog,
        { signal },
      );
      return payload.prizes;
    } catch (reason) {
      if (reason instanceof ApiError && reason.code === "PROTOCOL_ERROR") {
        throw new ApiError("CATALOG_INVALID_RESPONSE", reason.status);
      }
      throw reason;
    }
  },
  login: (username: string, password: string, signal?: AbortSignal) =>
    request<Session>("/api/auth/login/", isSession, {
      method: "POST",
      body: JSON.stringify({ username, password }),
      signal,
    }),
  logout: (signal?: AbortSignal) =>
    request<{ ok: boolean }>("/api/auth/logout/", isOk, { method: "POST", signal }),
  spin: (requestId: string, signal?: AbortSignal) =>
    request<SpinResult>("/api/spin/", isSpinResult, {
      method: "POST",
      headers: { "Idempotency-Key": requestId },
      signal,
    }),
  recoverSpin: (requestId: string, signal?: AbortSignal) =>
    request<SpinResult>(
      `/api/spin/${encodeURIComponent(requestId)}/`,
      isSpinResult,
      { signal },
    ),
};

export { ApiError };
