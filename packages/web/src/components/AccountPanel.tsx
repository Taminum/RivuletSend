import { useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api";

const PASSWORD_ERRORS: Record<string, string> = {
  wrong_password: "Current password is incorrect.",
  no_password_set: "This account has no password to change.",
  invalid_input: "New password must be at least 8 characters.",
};

export function AccountPanel() {
  const { user, changePassword } = useAuth();
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwOk, setPwOk] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);

  if (!user) return null;

  const hasPassword = Boolean(user.email); // password is only ever set alongside email

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
    </div>
  );
}
