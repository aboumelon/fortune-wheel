import { useCallback, useEffect, useRef, useState } from "react";

import { api, ApiError } from "./api";
import { Login } from "./components/Login";
import { PrizeModal } from "./components/PrizeModal";
import { Wheel } from "./components/Wheel";
import { errorMessage, t } from "./i18n";
import { clearPendingRequest, readPendingRequest, savePendingRequest } from "./pendingSpins";
import type { Prize, Session, SpinPhase, SpinResult } from "./types";

type StartupStatus = "loading" | "ready" | "error";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fa-IR", {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function targetRotation(
  currentRotation: number,
  slot: number,
  naturalOffset: number,
  extraTurns: number,
) {
  const current = ((currentRotation % 360) + 360) % 360;
  const target = ((360 - slot * 30 + naturalOffset) % 360 + 360) % 360;
  const delta = ((target - current + 360) % 360) + extraTurns * 360;
  return currentRotation + delta;
}

function applyResult(session: Session, result: SpinResult): Session {
  const historyItem = {
    id: result.spinId,
    prize: result.prize,
    createdAt: result.createdAt,
  };
  const withoutDuplicate = session.history.filter((item) => item.id !== result.spinId);
  return {
    ...session,
    remainingCoupons: result.remainingCoupons,
    history: [historyItem, ...withoutDuplicate].slice(0, 8),
  };
}

function messageFrom(reason: unknown) {
  return reason instanceof ApiError
    ? errorMessage(reason.code)
    : errorMessage("UNKNOWN_ERROR");
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [startupStatus, setStartupStatus] = useState<StartupStatus>("loading");
  const [startupError, setStartupError] = useState("");
  const [spinPhase, setSpinPhase] = useState<SpinPhase>("idle");
  const [rotation, setRotation] = useState(0);
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);
  const [pendingResult, setPendingResult] = useState<SpinResult | null>(null);
  const [wonPrize, setWonPrize] = useState<Prize | null>(null);
  const [notice, setNotice] = useState("");
  const rotationRef = useRef(0);
  const spinButtonRef = useRef<HTMLButtonElement>(null);
  const startupControllerRef = useRef<AbortController | null>(null);

  const updateAwardSlot = useCallback((prize: Prize) => {
    setPrizes((current) => current.map((item) => item.slot === prize.slot ? prize : item));
  }, []);

  const revealRecoveredResult = useCallback((result: SpinResult) => {
    const recoveredRotation = targetRotation(rotationRef.current, result.prize.slot, 0, 0);
    rotationRef.current = recoveredRotation;
    setRotation(recoveredRotation);
    updateAwardSlot(result.prize);
    setSession((current) => (current ? applyResult(current, result) : current));
    setPendingResult(result);
    setWonPrize(result.prize);
    setSpinPhase("idle");
    setNotice(t("spin.recovered"));
  }, [updateAwardSlot]);

  const handleAuthExpiry = useCallback((reason: ApiError) => {
    if (reason.code !== "AUTH_REQUIRED" && reason.status !== 401) return false;
    setSession(null);
    setSpinPhase("idle");
    setNotice(errorMessage("AUTH_REQUIRED"));
    return true;
  }, []);

  const recoverAttempt = useCallback(async (
    activeSession: Session,
    requestId: string,
    signal?: AbortSignal,
  ) => {
    setPendingRequestId(requestId);
    setSpinPhase("recovering");
    setNotice(t("spin.uncertain"));
    try {
      let result: SpinResult;
      try {
        result = await api.recoverSpin(requestId, signal);
      } catch (reason) {
        if (!(reason instanceof ApiError) || reason.code !== "SPIN_NOT_FOUND") throw reason;
        result = await api.spin(requestId, signal);
      }
      if (signal?.aborted) return;
      revealRecoveredResult(result);
    } catch (reason) {
      if (signal?.aborted) return;
      if (reason instanceof ApiError && handleAuthExpiry(reason)) return;
      if (reason instanceof ApiError && reason.code === "NO_COUPONS") {
        clearPendingRequest(activeSession.user.id, requestId);
        setPendingRequestId(null);
        setSpinPhase("idle");
        setNotice(errorMessage(reason.code));
        try {
          const freshSession = await api.session(signal);
          setSession(freshSession);
        } catch {
          // The definite error is already visible; refresh is best-effort only.
        }
        return;
      }
      setSpinPhase("recovering");
      setNotice(messageFrom(reason));
    }
  }, [handleAuthExpiry, revealRecoveredResult]);

  const initialize = useCallback(async () => {
    startupControllerRef.current?.abort();
    const controller = new AbortController();
    startupControllerRef.current = controller;
    setStartupStatus("loading");
    setStartupError("");
    try {
      await api.csrf(controller.signal);
      const [availablePrizes, activeSession] = await Promise.all([
        api.prizes(controller.signal),
        api.session(controller.signal).catch((reason) => {
          if (reason instanceof ApiError && reason.status === 401) return null;
          throw reason;
        }),
      ]);
      if (controller.signal.aborted) return;
      setPrizes(availablePrizes);
      setSession(activeSession);
      setStartupStatus("ready");

      if (activeSession) {
        const requestId = readPendingRequest(activeSession.user.id);
        if (requestId) void recoverAttempt(activeSession, requestId, controller.signal);
      }
    } catch (reason) {
      if (controller.signal.aborted) return;
      setStartupError(messageFrom(reason));
      setStartupStatus("error");
    }
  }, [recoverAttempt]);

  useEffect(() => {
    void initialize();
    return () => startupControllerRef.current?.abort();
  }, [initialize]);

  async function login(username: string, password: string) {
    const activeSession = await api.login(username, password);
    setSession(activeSession);
    setNotice("");
    try {
      const availablePrizes = await api.prizes();
      setPrizes(availablePrizes);
      setStartupStatus("ready");
    } catch (reason) {
      setStartupError(messageFrom(reason));
      setStartupStatus("error");
      return;
    }

    const requestId = readPendingRequest(activeSession.user.id);
    if (requestId) void recoverAttempt(activeSession, requestId);
  }

  async function logout() {
    if (spinPhase !== "idle") return;
    try {
      await api.logout();
      setSession(null);
      setWonPrize(null);
      setPendingResult(null);
      setNotice("");
    } catch (reason) {
      setNotice(messageFrom(reason));
    }
  }

  async function spin() {
    if (!session || spinPhase !== "idle" || session.remainingCoupons < 1) return;
    const requestId = crypto.randomUUID();
    savePendingRequest(session.user.id, requestId);
    setPendingRequestId(requestId);
    setSpinPhase("requesting");
    setNotice("");
    try {
      const result = await api.spin(requestId);
      updateAwardSlot(result.prize);
      const naturalOffset = Math.random() * 6 - 3;
      const extraTurns = 7 + Math.floor(Math.random() * 3);
      const nextRotation = targetRotation(
        rotationRef.current,
        result.prize.slot,
        naturalOffset,
        extraTurns,
      );
      rotationRef.current = nextRotation;
      setPendingResult(result);
      setRotation(nextRotation);
      setSpinPhase("animating");
    } catch (reason) {
      if (reason instanceof ApiError && handleAuthExpiry(reason)) return;
      const definiteFailure =
        reason instanceof ApiError &&
        ["NO_COUPONS", "INVALID_IDEMPOTENCY_KEY"].includes(reason.code);
      if (definiteFailure) {
        clearPendingRequest(session.user.id, requestId);
        setPendingRequestId(null);
        setSpinPhase("idle");
        setNotice(messageFrom(reason));
        if (reason.code === "NO_COUPONS") {
          setSession((current) => current ? { ...current, remainingCoupons: 0 } : current);
        }
      } else {
        setSpinPhase("recovering");
        setNotice(t("spin.uncertain"));
      }
    }
  }

  const finishSpin = useCallback(() => {
    if (!pendingResult) return;
    setSession((current) => (current ? applyResult(current, pendingResult) : current));
    setSpinPhase("idle");
    setWonPrize(pendingResult.prize);
  }, [pendingResult]);

  function closePrize() {
    if (session && pendingResult) clearPendingRequest(session.user.id, pendingResult.requestId);
    setPendingRequestId(null);
    setPendingResult(null);
    setWonPrize(null);
    setNotice("");
    if (session) {
      const nextRequestId = readPendingRequest(session.user.id);
      if (nextRequestId) void recoverAttempt(session, nextRequestId);
    }
  }

  function retryRecovery() {
    if (session && pendingRequestId) void recoverAttempt(session, pendingRequestId);
  }

  if (startupStatus === "loading") {
    return (
      <main className="splash">
        <div className="splash-wheel" aria-hidden="true">✦</div>
        <p>{t("loading.preparing")}</p>
      </main>
    );
  }

  if (startupStatus === "error") {
    return (
      <main className="startup-error" role="alert">
        <div className="brand-mark" aria-hidden="true">✦</div>
        <h1>{t("startup.title")}</h1>
        <p>{startupError || t("startup.message")}</p>
        <button className="primary-button" onClick={() => void initialize()}>
          {t("common.retry")}
        </button>
      </main>
    );
  }

  if (!session) return <Login onLogin={login} notice={notice} />;

  const catalogReady =
    prizes.length === 12 &&
    [...prizes].sort((a, b) => a.slot - b.slot).every((prize, index) => prize.slot === index);

  return (
    <>
      <div className="app-shell" id="application-content">
        <div className="ambient ambient-one" />
        <div className="ambient ambient-two" />
        <header className="topbar">
          <a className="brand" href="#top" aria-label={t("app.brandAria")}>
            <span className="mini-mark">✦</span>
            <span>{t("app.title")}</span>
          </a>
          <div className="user-area">
            <div className="avatar">{session.user.displayName.slice(0, 1)}</div>
            <div className="user-name">
              <small>{t("app.welcome")}</small>
              <strong>{session.user.displayName}</strong>
            </div>
            <button
              className="logout-button"
              onClick={() => void logout()}
              aria-label={t("app.logout")}
              disabled={spinPhase !== "idle"}
            >
              {t("app.logout")}
            </button>
          </div>
        </header>

        <main id="top" className="dashboard">
          <section className="hero-copy">
            <p className="eyebrow"><span>✦</span> {t("app.heroEyebrow")}</p>
            <h1>{t("app.heroTitleFirst")}<br /><em>{t("app.heroTitleSecond")}</em></h1>
            <p>{t("app.heroCopy")}</p>
            <div className="coupon-card">
              <div className="ticket-icon" aria-hidden="true">🎟️</div>
              <div>
                <small>{t("app.remainingCoupons")}</small>
                <strong>{new Intl.NumberFormat("fa-IR").format(session.remainingCoupons)}</strong>
              </div>
              <span className="coupon-word">{t("app.coupon")}</span>
            </div>
            {notice && <p className="notice" role="alert">{notice}</p>}
            {spinPhase === "recovering" && pendingRequestId && (
              <button className="secondary-button recovery-button" onClick={retryRecovery}>
                {t("spin.retryRecovery")}
              </button>
            )}
          </section>

          <section className="wheel-column" aria-label={t("app.wheelSection")}>
            <Wheel
              prizes={prizes}
              rotation={rotation}
              phase={spinPhase}
              hasCoupons={session.remainingCoupons > 0}
              catalogReady={catalogReady}
              onSpin={() => void spin()}
              onSpinComplete={finishSpin}
              buttonRef={spinButtonRef}
            />
            <p className="spin-tip"><span>◈</span> {t("app.spinTip")}</p>
            <div className="mobile-prize-list" aria-label={t("app.prizeList")}>
              {[...prizes].sort((a, b) => a.slot - b.slot).map((prize) => (
                <span key={`legend-${prize.slot}`}>
                  <i aria-hidden="true">{prize.icon}</i>
                  {prize.name}
                </span>
              ))}
            </div>
          </section>
        </main>

        <section className="history-section" aria-labelledby="history-title">
          <div className="section-title">
            <div>
              <p className="eyebrow">{t("app.historyEyebrow")}</p>
              <h2 id="history-title">{t("app.historyTitle")}</h2>
            </div>
            <span>{t("app.prizeCount", { count: session.history.length })}</span>
          </div>
          {session.history.length ? (
            <div className="history-grid">
              {session.history.map((item) => (
                <article className="history-card" key={item.id}>
                  <div className="history-icon" style={{ backgroundColor: `${item.prize.color}2b` }}>
                    {item.prize.icon}
                  </div>
                  <div>
                    <h3>{item.prize.name}</h3>
                    <time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time>
                  </div>
                  <span className="won-badge">{t("app.wonBadge")}</span>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-history">{t("app.emptyHistory")}</div>
          )}
        </section>
      </div>

      {wonPrize && (
        <PrizeModal
          prize={wonPrize}
          onClose={closePrize}
          returnFocusRef={spinButtonRef}
        />
      )}
    </>
  );
}
