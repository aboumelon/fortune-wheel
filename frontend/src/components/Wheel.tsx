import { type RefObject, useEffect, useMemo, useRef } from "react";

import { t } from "../i18n";
import type { Prize, SpinPhase } from "../types";

type WheelProps = {
  prizes: Prize[];
  rotation: number;
  phase: SpinPhase;
  hasCoupons: boolean;
  catalogReady: boolean;
  onSpin: () => void;
  onSpinComplete: () => void;
  buttonRef?: RefObject<HTMLButtonElement | null>;
};

const FULL_PRIZE_COUNT = 12;
const TRANSITION_FALLBACK_MS = 6_200;

function buttonLabel(phase: SpinPhase, hasCoupons: boolean, catalogReady: boolean) {
  if (!catalogReady) return t("wheel.invalidCatalog");
  if (phase === "requesting") return t("wheel.requesting");
  if (phase === "animating") return t("wheel.spinning");
  if (phase === "recovering") return t("wheel.recovering");
  if (!hasCoupons) return t("wheel.noCoupons");
  return t("wheel.spin");
}

export function Wheel({
  prizes,
  rotation,
  phase,
  hasCoupons,
  catalogReady,
  onSpin,
  onSpinComplete,
  buttonRef,
}: WheelProps) {
  const completedRef = useRef(false);
  const animating = phase === "animating";
  const ordered = useMemo(() => {
    const slots = Array<Prize | undefined>(FULL_PRIZE_COUNT).fill(undefined);
    prizes.forEach((prize) => {
      if (prize.slot >= 0 && prize.slot < FULL_PRIZE_COUNT) slots[prize.slot] = prize;
    });
    return slots;
  }, [prizes]);

  const gradient = ordered
    .map((prize, index) => {
      const start = index * 30;
      const end = start + 30;
      return `${prize?.color ?? "#34265a"} ${start}deg ${end}deg`;
    })
    .join(", ");

  useEffect(() => {
    if (!animating) return;
    completedRef.current = false;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timeout = window.setTimeout(
      () => {
        if (!completedRef.current) {
          completedRef.current = true;
          onSpinComplete();
        }
      },
      reduceMotion ? 50 : TRANSITION_FALLBACK_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [animating, onSpinComplete, rotation]);

  function transitionFinished(event: React.TransitionEvent<HTMLDivElement>) {
    if (
      animating &&
      event.target === event.currentTarget &&
      event.propertyName === "transform" &&
      !completedRef.current
    ) {
      completedRef.current = true;
      onSpinComplete();
    }
  }

  const disabled = !catalogReady || !hasCoupons || phase !== "idle";

  return (
    <div className="wheel-stage">
      <div className={`pointer ${animating ? "pointer-active" : ""}`} aria-hidden="true">
        <span />
      </div>
      <div className="wheel-outer">
        <div
          className={`wheel ${animating ? "is-spinning" : ""}`}
          style={{
            background: `conic-gradient(from -15deg, ${gradient})`,
            transform: `rotate(${rotation}deg)`,
          }}
          aria-label={t("wheel.ariaLabel")}
          onTransitionEnd={transitionFinished}
        >
          {ordered.map((prize, index) => (
            <div
              className="wheel-label"
              key={`slot-${index}`}
              style={{ transform: `rotate(${index * 30}deg)` }}
            >
              <span className="prize-icon" aria-hidden="true">
                {prize?.icon ?? t("wheel.fallbackIcon")}
              </span>
              <strong>{prize?.name ?? t("wheel.fallbackPrize")}</strong>
            </div>
          ))}
          <div className="wheel-hub" aria-hidden="true">
            <span>✦</span>
          </div>
        </div>
      </div>
      <button
        ref={buttonRef}
        className="primary-button spin-button"
        onClick={onSpin}
        disabled={disabled}
        aria-live="polite"
      >
        {buttonLabel(phase, hasCoupons, catalogReady)}
      </button>
    </div>
  );
}
