import { useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { ApiError, type TelegramAuthData } from "../api";
import { TelegramLoginButton, telegramConfigured } from "./TelegramLoginButton";

const ERROR_MESSAGES: Record<string, string> = {
  email_taken: "That email is already registered. Try signing in.",
  invalid_credentials: "Wrong email or password.",
  invalid_input: "Please check the details you entered.",
  invalid_telegram_signature: "Telegram sign-in failed. Please try again.",
  telegram_not_configured: "Telegram sign-in isn't available right now.",
};

function friendlyError(err: unknown): string {
  if (err instanceof ApiError) return ERROR_MESSAGES[err.code] ?? `Something went wrong (${err.code}).`;
  return "Network error — is the API running?";
}

export function AuthScreen({ onCancel }: { onCancel?: () => void }) {
  const { login, signup, loginWithTelegram } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isSignup = mode === "signup";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (isSignup) await signup(displayName.trim(), email.trim(), password);
      else await login(email.trim(), password);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleTelegram(user: TelegramAuthData) {
    setError(null);
    try {
      await loginWithTelegram(user);
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  return (
    <div className="card">
      <div className="panel-title">{isSignup ? "Create account" : "Sign in"}</div>
      <p className="muted" style={{ marginTop: -8, marginBottom: 16 }}>
        {isSignup
          ? "Save contacts and transfer history. Your files still go peer-to-peer."
          : "Sign in to use contacts and history."}
      </p>

      <form onSubmit={handleSubmit}>
        {isSignup && (
          <div className="field">
            <label>Display name</label>
            <input
              className="input"
              type="text"
              autoComplete="name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
            />
          </div>
        )}
        <div className="field">
          <label>Email</label>
          <input
            className="input"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label>Password</label>
          <input
            className="input"
            type="password"
            autoComplete={isSignup ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={isSignup ? 8 : undefined}
            required
          />
        </div>

        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
          {busy ? "…" : isSignup ? "Create account" : "Sign in"}
        </button>
      </form>

      {telegramConfigured() && (
        <>
          <div className="divider">or continue with</div>
          <div className="tg-wrap">
            <TelegramLoginButton onAuth={handleTelegram} />
          </div>
        </>
      )}

      {error && <p className="error">{error}</p>}

      <div className="divider">·</div>
      <button
        className="btn btn-ghost btn-block"
        onClick={() => {
          setError(null);
          setMode(isSignup ? "login" : "signup");
        }}
      >
        {isSignup ? "I already have an account" : "Create a new account"}
      </button>
      {onCancel && (
        <button className="link-btn" style={{ width: "100%", marginTop: 10 }} onClick={onCancel}>
          ← Continue without an account
        </button>
      )}
    </div>
  );
}
