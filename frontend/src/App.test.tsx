import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App, { targetRotation } from "./App";
import { api, ApiError } from "./api";
import { t } from "./i18n";
import { savePendingRequest } from "./pendingSpins";
import type { Prize, Session, SpinResult } from "./types";

vi.mock("./api", () => {
  class MockApiError extends Error {
    code: string;
    status: number;

    constructor(code: string, status = 0) {
      super(code);
      this.code = code;
      this.status = status;
    }
  }
  return {
    ApiError: MockApiError,
    api: {
      csrf: vi.fn(),
      session: vi.fn(),
      prizes: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      spin: vi.fn(),
      recoverSpin: vi.fn(),
    },
  };
});

const prizes: Prize[] = Array.from({ length: 12 }, (_, slot) => ({
  id: slot + 1,
  slot,
  name: `Prize ${slot}`,
  description: `Description ${slot}`,
  icon: "★",
  color: "#7C3AED",
}));

const session: Session = {
  user: { id: 7, username: "sara", displayName: "Sara" },
  remainingCoupons: 1,
  history: [],
};

describe("targetRotation", () => {
  it("lands safely inside every sector across 288 cases", () => {
    const offsets = [-3, -1.8, -0.6, 0.6, 1.8, 3];
    const previousRotations = [0, 123.4, 720, -450];
    let cases = 0;
    for (let slot = 0; slot < 12; slot += 1) {
      for (const offset of offsets) {
        for (const previous of previousRotations) {
          const next = targetRotation(previous, slot, offset, 7);
          const normalized = ((next % 360) + 360) % 360;
          const expected = ((360 - slot * 30 + offset) % 360 + 360) % 360;
          expect(normalized).toBeCloseTo(expected, 8);
          expect(Math.abs(offset)).toBeLessThan(15);
          expect(next).toBeGreaterThan(previous);
          cases += 1;
        }
      }
    }
    expect(cases).toBe(288);
  });
});

describe("App recovery", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.mocked(api.csrf).mockResolvedValue("csrf");
    vi.mocked(api.prizes).mockResolvedValue(prizes);
    vi.mocked(api.session).mockResolvedValue(session);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("restores a persisted spin and lets the user acknowledge the award", async () => {
    const requestId = "8c17f575-ec3c-4e32-9e55-67c1e0ea09bd";
    const result: SpinResult = {
      spinId: "775b7d8a-a24f-41ae-b12d-98683cebeeee",
      requestId,
      prize: prizes[4],
      remainingCoupons: 0,
      createdAt: "2026-09-30T10:00:00Z",
      replayed: true,
    };
    window.localStorage.setItem(`fortune-wheel:pending-spin:${session.user.id}`, requestId);
    vi.mocked(api.recoverSpin).mockResolvedValue(result);

    render(<App />);

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(api.recoverSpin).toHaveBeenCalledWith(requestId, expect.any(AbortSignal));
    expect(screen.getByLabelText(t("wheel.ariaLabel"))).toHaveStyle({ transform: "rotate(240deg)" });
    expect(screen.getByLabelText(t("wheel.ariaLabel"))).not.toHaveClass("is-spinning");
    await userEvent.click(screen.getByRole("button", { name: t("modal.confirm") }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(window.localStorage.getItem(`fortune-wheel:pending-spin:${session.user.id}`)).toBeNull();
    expect(window.localStorage.getItem(`fortune-wheel:pending-spin:${session.user.id}:${requestId}`)).toBeNull();
  });

  it("shows startup failures and provides a working retry", async () => {
    vi.mocked(api.csrf)
      .mockRejectedValueOnce(new ApiError("NETWORK_ERROR"))
      .mockResolvedValueOnce("csrf");
    vi.mocked(api.session).mockRejectedValue(new ApiError("AUTH_REQUIRED", 401));

    render(<App />);

    expect(await screen.findByText(errorMessageForTest("NETWORK_ERROR"))).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: t("common.retry") }));
    await waitFor(() => expect(screen.getByRole("heading", { name: t("login.title") })).toBeVisible());
  });

  it("returns to login on an expired spin session while preserving recovery data", async () => {
    const requestId = "8c17f575-ec3c-4e32-9e55-67c1e0ea09bd";
    vi.spyOn(crypto, "randomUUID").mockReturnValue(requestId);
    vi.mocked(api.spin).mockRejectedValue(new ApiError("AUTH_REQUIRED", 401));

    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: t("wheel.spin") }));
    expect(await screen.findByRole("heading", { name: t("login.title") })).toBeVisible();
    expect(window.localStorage.getItem(`fortune-wheel:pending-spin:${session.user.id}:${requestId}`)).not.toBeNull();
    expect(screen.getByText(t("error.AUTH_REQUIRED"))).toBeVisible();
  });

  it("preserves another tab's attempt when acknowledging a result and recovers it after reload", async () => {
    const firstId = "8c17f575-ec3c-4e32-9e55-67c1e0ea09bd";
    const secondId = "013d7a31-0488-4ef8-b1f4-35a32345a5b7";
    const firstResult: SpinResult = {
      spinId: "775b7d8a-a24f-41ae-b12d-98683cebeeee",
      requestId: firstId,
      prize: prizes[4],
      remainingCoupons: 0,
      createdAt: "2026-09-30T10:00:00Z",
      replayed: true,
    };
    const secondResult: SpinResult = {
      ...firstResult,
      spinId: "16bca283-cc07-45d6-b7e1-8b32fb83483f",
      requestId: secondId,
      prize: prizes[8],
    };
    savePendingRequest(session.user.id, firstId);
    vi.mocked(api.recoverSpin).mockImplementation(async (requestId) =>
      requestId === firstId ? firstResult : secondResult,
    );
    const view = render(<App />);
    expect(await screen.findByRole("dialog")).toHaveTextContent(prizes[4].name);

    // Another tab writes its own key while the first award is still open.
    const secondKey = `fortune-wheel:pending-spin:${session.user.id}:${secondId}`;
    window.localStorage.setItem(secondKey, String(Date.now()));
    await userEvent.click(screen.getByRole("button", { name: t("modal.confirm") }));
    expect(await screen.findByRole("dialog")).toHaveTextContent(prizes[8].name);
    expect(window.localStorage.getItem(secondKey)).not.toBeNull();
    view.unmount();
    render(<App />);
    expect(await screen.findByRole("dialog")).toHaveTextContent(prizes[8].name);
    expect(api.spin).not.toHaveBeenCalled();
  });

  it("starts a subsequent animated spin from the recovered wheel position", async () => {
    const requestId = "8c17f575-ec3c-4e32-9e55-67c1e0ea09bd";
    const recovered: SpinResult = {
      spinId: "775b7d8a-a24f-41ae-b12d-98683cebeeee",
      requestId,
      prize: prizes[4],
      remainingCoupons: 1,
      createdAt: "2026-09-30T10:00:00Z",
      replayed: true,
    };
    savePendingRequest(session.user.id, requestId);
    vi.mocked(api.recoverSpin).mockResolvedValue(recovered);
    vi.mocked(api.spin).mockImplementation(async (newRequestId) => ({
      ...recovered,
      requestId: newRequestId,
      spinId: "16bca283-cc07-45d6-b7e1-8b32fb83483f",
      prize: prizes[8],
      replayed: false,
    }));
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    render(<App />);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: t("modal.confirm") }));
    await userEvent.click(screen.getByRole("button", { name: t("wheel.spin") }));
    const wheel = screen.getByLabelText(t("wheel.ariaLabel"));
    await waitFor(() => expect(wheel).toHaveClass("is-spinning"));
    expect(wheel).toHaveStyle({ transform: `rotate(${targetRotation(240, 8, 0, 8)}deg)` });
  });

  it.each([false, true])("uses the immutable award display data for the winning sector (recovery=%s)", async (recovery) => {
    const requestId = "8c17f575-ec3c-4e32-9e55-67c1e0ea09bd";
    const award = { ...prizes[4], name: "Updated prize", description: "Updated description", icon: "♦", color: "#123456" };
    const result: SpinResult = {
      spinId: "775b7d8a-a24f-41ae-b12d-98683cebeeee",
      requestId,
      prize: award,
      remainingCoupons: 0,
      createdAt: "2026-09-30T10:00:00Z",
      replayed: recovery,
    };
    if (recovery) {
      savePendingRequest(session.user.id, requestId);
      vi.mocked(api.recoverSpin).mockResolvedValue(result);
    } else {
      vi.mocked(api.spin).mockResolvedValue(result);
    }
    render(<App />);
    if (!recovery) {
      await userEvent.click(await screen.findByRole("button", { name: t("wheel.spin") }));
    }
    const wheel = await screen.findByLabelText(t("wheel.ariaLabel"));
    await waitFor(() => expect(within(wheel).getByText(award.name)).toBeInTheDocument());
    expect(wheel.style.background).toContain("rgb(18, 52, 86) 120deg 150deg");
    expect(wheel.querySelectorAll(".wheel-label")).toHaveLength(12);
    expect(within(wheel).queryByText(prizes[4].name)).not.toBeInTheDocument();
    if (!recovery) fireEvent.transitionEnd(wheel, { propertyName: "transform" });
    expect(await screen.findByRole("dialog")).toHaveTextContent(award.name);
  });
});

function errorMessageForTest(code: string) {
  return t(`error.${code}` as Parameters<typeof t>[0]);
}
