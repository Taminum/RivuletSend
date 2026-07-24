import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type ApiDevice } from "../api";

function relativeTime(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

// Approving side: manage linked devices and approve a new one by its code (the
// button most people click — "I'm signed in on my phone, add this laptop").
export function PairedDevices() {
  const [devices, setDevices] = useState<ApiDevice[]>([]);
  const [linking, setLinking] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [info, setInfo] = useState<{ requestedPlatform: string | null; createdAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { devices } = await api.listDevices();
      setDevices(devices);
    } catch {
      /* keep existing */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const code = codeInput.replace(/\D/g, "").slice(0, 6);

  // Step 1: look the code up so we can show WHAT we're approving before doing it.
  async function lookUp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      setInfo(await api.pairingInfo(code));
    } catch (err) {
      setError(err instanceof ApiError && err.code === "not_found_or_expired"
        ? "That code isn't valid or has expired."
        : "Couldn't check that code.");
    } finally {
      setBusy(false);
    }
  }

  // Step 2: confirm — this hands over full account access, so it's deliberate.
  async function approve() {
    setError(null);
    setBusy(true);
    try {
      await api.pairingApprove({ code });
      resetLink();
      await load();
    } catch {
      setError("Couldn't approve that device — the code may have just expired.");
    } finally {
      setBusy(false);
    }
  }

  function resetLink() {
    setLinking(false);
    setCodeInput("");
    setInfo(null);
    setError(null);
  }

  async function remove(id: string) {
    await api.revokeDevice(id);
    await load();
  }

  async function rename(id: string, current: string) {
    const next = window.prompt("Device name", current);
    if (next === null) return; // cancelled
    const label = next.trim();
    if (!label || label === current) return;
    try {
      await api.renameDevice(id, label);
      await load();
    } catch {
      setError("Couldn't rename that device.");
    }
  }

  return (
    <div className="card">
      <div className="panel-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>Paired devices</span>
        {!linking && (
          <button className="btn btn-primary btn-sm" onClick={() => setLinking(true)}>
            Link a new device
          </button>
        )}
      </div>
      {!linking && (
        <p className="muted" style={{ marginTop: -6, marginBottom: 14 }}>
          Link your own devices (e.g. your Windows client) so you can send files
          straight to them from the Send screen — no code, no confirmation. On the
          new device, open the sign-in screen and choose{" "}
          <strong style={{ color: "var(--text)" }}>“Link this device with a code”</strong>; it
          shows a 6-digit code. Tap “Link a new device” here and enter that code.
        </p>
      )}

      {linking && (
        <div className="card" style={{ marginBottom: 14, background: "var(--surface-2)" }}>
          {!info ? (
            <form onSubmit={lookUp}>
              <div className="field">
                <label>Enter the 6-digit code shown on the new device</label>
                <input
                  className="input code-input"
                  placeholder="······"
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCodeInput(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="row">
                <button className="btn btn-primary" type="submit" disabled={code.length !== 6 || busy}>
                  Continue
                </button>
                <button className="btn btn-ghost" type="button" onClick={resetLink}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div>
              <p className="muted" style={{ marginTop: 0 }}>
                Approve a{" "}
                <strong style={{ color: "var(--text)" }}>{info.requestedPlatform ?? "new"}</strong>{" "}
                device that asked to link {relativeTime(info.createdAt)}? This gives it full
                access to your account.
              </p>
              <div className="row">
                <button className="btn btn-primary" onClick={() => void approve()} disabled={busy}>
                  Approve &amp; link
                </button>
                <button className="btn btn-ghost" onClick={resetLink} disabled={busy}>
                  Cancel
                </button>
              </div>
            </div>
          )}
          {error && <p className="error">{error}</p>}
        </div>
      )}

      {devices.length === 0 ? (
        <p className="empty-hint">No linked devices yet.</p>
      ) : (
        <ul className="file-list">
          {devices.map((d) => (
            <li key={d.id} className="file-row">
              <span className="file-meta">
                <span className="file-name">
                  {d.label}
                  {d.isCurrent && <span className="muted"> · this device</span>}
                </span>
                <span className="file-sub">
                  {d.platform ? `${d.platform} · ` : ""}last seen {relativeTime(d.lastSeenAt)}
                </span>
              </span>
              <span className="row-actions">
                <button className="link-btn" onClick={() => void rename(d.id, d.label)}>
                  Rename
                </button>
                <button className="link-btn" onClick={() => void remove(d.id)}>
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
