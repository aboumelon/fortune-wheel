import { afterEach, expect, it, vi } from "vitest";

import { api } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("rejects a malformed successful catalog as a protocol error", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ prizes: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );

  await expect(api.prizes()).rejects.toMatchObject({
    code: "CATALOG_INVALID_RESPONSE",
  });
});

it("normalizes browser transport failures without exposing their text", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

  await expect(api.prizes()).rejects.toMatchObject({ code: "NETWORK_ERROR" });
});

it("validates the successful CSRF response shape before using it", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ token: "wrong-field" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );

  await expect(api.csrf()).rejects.toMatchObject({ code: "PROTOCOL_ERROR" });
});
