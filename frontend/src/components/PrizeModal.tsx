import { type RefObject, useEffect, useRef } from "react";

import { t } from "../i18n";
import type { Prize } from "../types";

type PrizeModalProps = {
  prize: Prize;
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
};

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function PrizeModal({ prize, onClose, returnFocusRef }: PrizeModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const trigger =
      returnFocusRef?.current ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const appContent = document.getElementById("application-content");
    const previousAriaHidden = appContent?.getAttribute("aria-hidden");
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (appContent) {
      appContent.setAttribute("inert", "");
      appContent.setAttribute("aria-hidden", "true");
    }
    closeButtonRef.current?.focus();

    function keyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", keyDown);
    return () => {
      document.removeEventListener("keydown", keyDown);
      document.body.style.overflow = previousOverflow;
      if (appContent) {
        appContent.removeAttribute("inert");
        if (previousAriaHidden == null) appContent.removeAttribute("aria-hidden");
        else appContent.setAttribute("aria-hidden", previousAriaHidden);
      }
      if (trigger && !trigger.hasAttribute("disabled")) trigger.focus();
    };
  }, [onClose, returnFocusRef]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="prize-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="prize-heading"
        aria-describedby="prize-description"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="confetti" aria-hidden="true">
          {Array.from({ length: 28 }, (_, index) => <i key={index} />)}
        </div>
        <button
          ref={closeButtonRef}
          className="modal-close"
          onClick={onClose}
          aria-label={t("modal.close")}
        >×</button>
        <p className="modal-kicker">{t("modal.kicker")}</p>
        <div className="won-icon" style={{ backgroundColor: prize.color }}>{prize.icon}</div>
        <h2 id="prize-heading">{prize.name}</h2>
        <p id="prize-description">{prize.description}</p>
        <button className="primary-button" onClick={onClose}>{t("modal.confirm")}</button>
      </div>
    </div>
  );
}
