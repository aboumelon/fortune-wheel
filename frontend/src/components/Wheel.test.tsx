import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { t } from "../i18n";
import { Wheel } from "./Wheel";

const prizes = Array.from({ length: 12 }, (_, slot) => ({
  id: slot + 1,
  slot,
  name: `Prize ${slot}`,
  description: "Description",
  icon: "★",
  color: "#7C3AED",
}));

it("finishes from the wheel transform transition instead of a page timer", () => {
  const onSpinComplete = vi.fn();
  render(
    <Wheel
      prizes={prizes}
      rotation={2520}
      phase="animating"
      hasCoupons
      catalogReady
      onSpin={vi.fn()}
      onSpinComplete={onSpinComplete}
    />,
  );

  const wheel = screen.getByLabelText(t("wheel.ariaLabel"));
  fireEvent.transitionEnd(wheel, { propertyName: "transform" });
  expect(onSpinComplete).toHaveBeenCalledOnce();
});

it("completes promptly when reduced motion is requested", () => {
  vi.useFakeTimers();
  vi.spyOn(window, "matchMedia").mockReturnValue({
    matches: true,
    media: "(prefers-reduced-motion: reduce)",
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  });
  const onSpinComplete = vi.fn();
  render(
    <Wheel
      prizes={prizes}
      rotation={2520}
      phase="animating"
      hasCoupons
      catalogReady
      onSpin={vi.fn()}
      onSpinComplete={onSpinComplete}
    />,
  );

  act(() => vi.advanceTimersByTime(50));
  expect(onSpinComplete).toHaveBeenCalledOnce();
  vi.useRealTimers();
});
