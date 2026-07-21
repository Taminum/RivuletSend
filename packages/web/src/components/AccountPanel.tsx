import { useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { ApiError, type TelegramAuthData } from "../api";
import { TelegramLoginButton, telegramConfigured } from "./TelegramLoginButton";

const LINK_ERRORS: Record<string, string> = {
  telegram_already_linked: "You've already linked a Telegram account.",
  telegram_in_use: "That Telegram account is linked to someone else.",
  invalid_telegram_signature: "Telegram verification failed. Try again.",
  cannot_unlink_only_method: "Add an email & password before unlinking Telegram.",
};

const PASSWORD_ERRORS: Record<string, string> = {
  wrong_password: "Current password is incorrect.",
  no_password_set: "This account has no password to change.",
  invalid_input: "New password must be at least 8 characters.",
};

export function AccountPanel() {
  const { user, linkTelegram, unlinkTelegram, changePassword } = useAuth();
  const [linkError, setLinkError] = useState<string | null>(null);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwOk, setPwOk] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);

  if (!user) return null;

  const hasPassword = Boolean(user.email); // password is only ever set alongside email
  const canUnlinkTelegram = Boolean(user.telegramId) && hasPassword;

  async function handleLink(data: TelegramAuthData) {
    setLinkError(null);
    try {
      await linkTelegram(data);
    } catch (err) {
      setLinkError(err instanceof ApiError ? (LINK_ERRORS[err.code] ?? "Couldn't link Telegram.") : "Network error.");
    }
  }

  async function handleUnlink() {
    setLinkError(null);
    try {
      await unlinkTelegram();
    } catch (err) {
      setLinkError(err instanceof ApiError ? (LINK_ERRORS[err.code] ?? "Couldn't unlink.") : "Network error.");
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwError(null);
    setPwOk(false);
    setBusy(true);
    try {
      await changePassword(current, next);
      setPwOk(true);
      setCurrent("");
      setNext("");
    } catch (err) {
      setPwError(err instanceof ApiError ? (PASSWORD_ERRORS[err.code] ?? "Couldn't change password.") : "Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="panel-title">Account</div>
      <ul className="account-list">
        <li>
          <span className="account-key">Name</span>
          <span className="account-val">{user.displayName}</span>
        </li>
        <li>
          <span className="account-key">Email</span>
          <span className="account-val">{user.email ?? "not linked"}</span>
        </li>
        <li>
          <span className="account-key">Telegram</span>
          <span className="account-val row-actions">
            {user.telegramId ? "linked" : "not linked"}
            {canUnlinkTelegram && (
              <button className="link-btn" onClick={() => void handleUnlink()}>
                unlink
              </button>
            )}
          </span>
        </li>
      </ul>

      {hasPassword && (
        <form onSubmit={handleChangePassword} style={{ marginTop: 18 }}>
          <div className="section-label">Change password</div>
          <div className="field">
            <input
              className="input"
              type="password"
              placeholder="Current password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <input
              className="input"
              type="password"
              placeholder="New password (min 8)"
              autoComplete="new-password"
              minLength={8}
              value={next}
              onChange={(e) => setNext(e.target.value)}
              required
            />
          </div>
          <button className="btn btn-ghost btn-sm" type="submit" disabled={busy}>
            {busy ? "…" : "Update password"}
          </button>
          {pwOk && <p className="muted" style={{ marginTop: 8 }}>Password updated.</p>}
          {pwError && <p className="error">{pwError}</p>}
        </form>
      )}

      {!user.telegramId && telegramConfigured() && (
        <div style={{ marginTop: 18 }}>
          <div className="section-label">Link Telegram</div>
          <TelegramLoginButton onAuth={handleLink} />
        </div>
      )}
      {linkError && <p className="error">{linkError}</p>}
    </div>
  );
}
