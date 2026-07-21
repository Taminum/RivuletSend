import { useCallback, useEffect, useRef, useState } from "react";
import { isValidRoomCode } from "@p2p/shared";
import type { CompletedTransfer, Transfer } from "../transfers";
import { useTransferSession } from "../hooks/useTransferSession";
import { canSaveFolder } from "../fileTransfer";
import { formatBytes } from "../format";
import { FileIcon, ReceiveIcon } from "../icons";
import { FilePreview } from "./FilePreview";
import { FolderRow } from "./FolderRow";
import { PulseLine } from "./PulseLine";

export function ReceiveView({ onComplete }: { onComplete?: (t: CompletedTransfer) => void }) {
  const { connected, transfers, folders, error, joinRoom } = useTransferSession(onComplete);
  const [code, setCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);
  const [preview, setPreview] = useState<Transfer | null>(null);
  const attempted = useRef(false);

  const connect = useCallback(
    async (raw: string) => {
      const norm = raw.trim().toUpperCase();
      if (!isValidRoomCode(norm) || joining) return;
      setJoining(true);
      try {
        await joinRoom(norm);
        setJoined(true);
      } catch {
        /* surfaced via hook */
      } finally {
        setJoining(false);
      }
    },
    [joinRoom, joining],
  );

  // Scan-to-receive: a #receive=CODE URL connects automatically.
  useEffect(() => {
    if (attempted.current) return;
    const m = window.location.hash.match(/receive=([A-Za-z0-9]+)/);
    if (m) {
      attempted.current = true;
      const c = m[1].toUpperCase();
      history.replaceState(null, "", window.location.pathname);
      setCode(c);
      void connect(c);
    }
  }, [connect]);

  if (!joined) {
    const valid = isValidRoomCode(code.trim().toUpperCase());
    return (
      <div className="view">
        <div className="card">
          <div className="field">
            <label>Enter the code from the sender</label>
            <input
              className="input code-input"
              placeholder="········"
              maxLength={8}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && valid && connect(code)}
            />
          </div>
          <button
            className="btn btn-primary btn-block"
            disabled={!valid || joining}
            onClick={() => connect(code)}
          >
            {joining ? "Connecting…" : "Connect"}
          </button>
          {error && <p className="error">{error}</p>}

          <p className="hint-line" style={{ marginBottom: 0 }}>
            This is for one-time codes. If someone sends to you as a contact, it arrives
            automatically — no code needed.
          </p>
          <p className="hint-line" style={{ margin: "4px 0 0" }}>
            Or scan the sender's QR code with your phone camera to open the link directly.
          </p>
        </div>
      </div>
    );
  }

  const received = transfers.filter((t) => t.direction === "receive");
  const receivedFolders = folders.filter((f) => f.direction === "receive");
  return (
    <div className="view">
      <div className="card">
        <div className="status-line" style={{ justifyContent: "flex-start" }}>
          <PulseLine active={connected} />
          {connected ? "Connected — waiting for files…" : "Connecting to sender…"}
        </div>
      </div>

      {receivedFolders.length > 0 && (
        <div className="card">
          <div className="panel-title">Received folders</div>
          <p className="muted" style={{ marginTop: -6, marginBottom: 12 }}>
            {canSaveFolder
              ? "Save the real folder tree to disk, or download it as a .zip."
              : "This browser can't write folders, so folders download as a .zip."}
          </p>
          <ul className="file-list">
            {receivedFolders.map((f) => (
              <FolderRow key={f.folderId} folder={f} />
            ))}
          </ul>
        </div>
      )}

      {received.length > 0 && (
        <div className="card">
          <div className="panel-title">Received</div>
          <ul className="file-list">
            {received.map((t) => {
              const pct = t.size ? Math.round((t.transferred / t.size) * 100) : 0;
              const done = pct >= 100;
              return (
                <li key={t.id} className="file-row">
                  <FileIcon size={18} className="file-icon" />
                  <span className="file-meta">
                    <span className="file-name">
                      {done && t.url ? (
                        <button className="linklike" onClick={() => setPreview(t)}>
                          {t.name}
                        </button>
                      ) : (
                        t.name
                      )}
                    </span>
                    <span className="file-sub">{done ? formatBytes(t.size) : `${pct}%`}</span>
                  </span>
                  {done && t.url && (
                    <a className="file-action" href={t.url} download={t.name} title="Download">
                      <ReceiveIcon size={18} />
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {preview && <FilePreview transfer={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
