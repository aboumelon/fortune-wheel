import { type FormEvent, useState } from "react";

import { ApiError } from "../api";
import { errorMessage, t } from "../i18n";

type LoginProps = {
  onLogin: (username: string, password: string) => Promise<void>;
  notice?: string;
};

export function Login({ onLogin, notice = "" }: LoginProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onLogin(username, password);
    } catch (reason) {
      setError(
        reason instanceof ApiError ? errorMessage(reason.code) : errorMessage("UNKNOWN_ERROR"),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-shell">
      <div className="login-glow login-glow-one" />
      <div className="login-glow login-glow-two" />
      <section className="login-card" aria-labelledby="login-title">
        <div className="brand-mark" aria-hidden="true">
          <span>✦</span>
        </div>
        <p className="eyebrow">{t("login.eyebrow")}</p>
        <h1 id="login-title">{t("login.title")}</h1>
        <p className="login-copy">{t("login.copy")}</p>

        {notice && <p className="form-error global-form-error" role="alert">{notice}</p>}
        <form onSubmit={submit}>
          <label htmlFor="username">{t("login.username")}</label>
          <div className="input-wrap">
            <span aria-hidden="true">◉</span>
            <input
              id="username"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder={t("login.usernamePlaceholder")}
              required
            />
          </div>

          <label htmlFor="password">{t("login.password")}</label>
          <div className="input-wrap">
            <span aria-hidden="true">◆</span>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={t("login.passwordPlaceholder")}
              required
            />
          </div>

          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button login-button" disabled={busy}>
            {busy ? (
              <span className="button-loader" role="status" aria-label={t("login.submitting")} />
            ) : t("login.submit")}
          </button>
        </form>
        <p className="demo-hint">{t("login.demoHint")} <bdi>demo / demo12345</bdi></p>
      </section>
    </main>
  );
}
