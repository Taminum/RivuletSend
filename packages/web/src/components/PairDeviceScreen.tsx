import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { api } from "../api";
import { QrCode } from "./QrCode";
import { PulseLine } from "./PulseLine";

// Requesting side of pairing: a fresh device shows a code + QR and polls until
// an already-signed-in device approves it — then it's logged in, no password.
type Phase = "loading" | "pending" | "expired" | "error";

function detectPlatform(): string {
  if (typeof window !== "undefined" && window.rivulet?.isDesktop) return "windows";
  return "web";
}

export function PairDeviceScreen({ onCancel }: { onCancel?: () => void }) {
  const { setUser } = useAuth();
  const [phase, setPhase] = useState<Phase>("loading");
  const [code, setCode] = useState<string | null>(null);
  const codeRef = useRef<string | null>(null);
  codeRef.current = code;

  const generate = useCallback(async () => {
    setPhase("loading");
    setCode(null);
    try {
      const { code } = await api.pairingRequest({ platform: detectPlatform() });
      setCode(code);
      setPhase("pending");
    } catch {
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    void generate();
  }, [generate]);

  // Poll for approval while a code is live.
  useEffect(() => {
    if (phase !== "pending" || !code) return;
    let stopped = false;
    const id = setInterval(async () => {
      try {
        const res = await api.pairingStatus(code);
        if (stopped) return;
        if (res.status === "approved" && res.user) {
          clearInterval(id);
          setUser(res.user); // now signed in on this device
        } else if (res.status === "expired") {
          clearInterval(id);
          setPhase("expired");
        }
      } catch {
        /* transient — keep polling */
      }
    }, 2000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [phase, code, setUser]);

  return (
    <div className="card">
      <div className="panel-title">Link this device</div>
      <p className="muted" style={{ marginTop: -8, marginBottom: 16 }}>
        On a device where you're already signed in, open Settings → Paired devices
        → “Link a new device” and enter this code — no password needed here.
      </p>

      {phase === "loading" && <p className="empty-hint">Generating a code…</p>}

      {phase === "error" && (
        <>
          <p className="error">Couldn't reach the server.</p>
          <button className="btn btn-primary btn-block" onClick={() => void generate()}>
            Try again
          </button>
        </>
      )}

      {phase === "expired" && (
        <div className="share-code-box">
          <div className="share-label">This code expired</div>
          <button className="btn btn-primary" onClick={() => void generate()}>
            Generate a new code
          </button>
        </div>
      )}

      {phase === "pending" && code && (
        <>
          <div className="share-code-box">
            <div className="share-label">Pairing code</div>
            <span className="share-code big">{code}</span>
          </div>
          <div className="qr-block">
            <QrCode text={`rivuletsend://pair?code=${code}`} size={128} />
            <span className="muted">or scan with a signed-in device</span>
          </div>
          <div className="status-line" style={{ marginTop: 18 }}>
            <PulseLine /> Waiting for approval…
          </div>
        </>
      )}

      {onCancel && (
        <button className="link-btn" style={{ width: "100%", marginTop: 16 }} onClick={onCancel}>
          ← Back to sign in
        </button>
      )}
    </div>
  );
}
