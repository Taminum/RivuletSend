import { useEffect, useRef, useState } from "react";
import { usePresence } from "../presence/PresenceContext";
import type { Transfer } from "../transfers";
import { formatBytes } from "../format";
import { FilePreview } from "./FilePreview";
import { PulseLine } from "./PulseLine";
import { FileIcon, XIcon, ReceiveIcon } from "../icons";

// Floating panel that surfaces contact (presence) transfers from anywhere in the
// app, so an incoming file is visible no matter which view you're on.
export function GlobalTransfers() {
  const { transfers, callStatus, callError, clearCallError } = usePresence();
  const [dismissed, setDismissed] = useState(false);
  const [preview, setPreview] = useState<Transfer | null>(null);
  const [received, setReceived] = useState<Transfer[]>([]);
  const announcedRef = useRef<Set<string>>(new Set());
  const prevCount = useRef(0);

  // A new transfer re-opens the panel even if previously dismissed.
  useEffect(() => {
    if (transfers.length > prevCount.current) setDismissed(false);
    prevCount.current = transfers.length;
  }, [transfers.length]);

  // Announce each newly-completed incoming file/message with a centered pop-up
  // (in addition to the corner panel), each transfer only once.
  useEffect(() => {
    const fresh = transfers.filter(
      (t) =>
        t.direction === "receive" &&
        t.url &&
        t.size > 0 &&
        t.transferred >= t.size &&
        !announcedRef.current.has(t.id),
    );
    if (fresh.length) {
      fresh.forEach((t) => announcedRef.current.add(t.id));
      setReceived((prev) => [...fresh, ...prev]);
    }
  }, [transfers]);

  // Centered announcement for just-received files/messages (no content preview).
  const isMessage = received.length === 1 && received[0].name === "message.txt";
  const receivedTitle =
    received.length > 1 ? "Files received" : isMessage ? "Message received" : "File received";
  const receivedModal =
    received.length > 0 ? (
      <div className="modal-overlay" onClick={() => setReceived([])}>
        <div className="modal received-modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-head">
            <div className="modal-title">
              <div className="file-name">{receivedTitle}</div>
            </div>
            <button className="icon-btn" onClick={() => setReceived([])} title="Close">
              <XIcon size={18} />
            </button>
          </div>
          <div className="modal-body" style={{ display: "block" }}>
            <ul className="file-list">
              {received.map((t) => (
                <li key={t.id} className="file-row">
                  <FileIcon size={18} className="file-icon" />
                  <span className="file-meta">
                    <span className="file-name">
                      {/* Клик по имени открывает предпросмотр поверх pop-up —
                          сам pop-up содержимое по-прежнему не показывает. */}
                      {t.url ? (
                        <button className="linklike" onClick={() => setPreview(t)} title="Предпросмотр">
                          {t.name || "file"}
                        </button>
                      ) : (
                        t.name || "file"
                      )}
                    </span>
                    <span className="file-sub">{formatBytes(t.size)}</span>
                  </span>
                  {t.savedPath ? (
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => void window.rivulet?.showInFolder?.(t.savedPath!)}
                      title={t.savedPath}
                    >
                      <ReceiveIcon size={14} /> Show in folder
                    </button>
                  ) : (
                    t.url && (
                      <a className="btn btn-primary btn-sm" href={t.url} download={t.name}>
                        <ReceiveIcon size={14} /> Save
                      </a>
                    )
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    ) : null;

  const hasContent = transfers.length > 0 || callStatus === "connecting" || !!callError;
  if (!hasContent || dismissed) {
    return (
      <>
        {receivedModal}
        {preview && <FilePreview transfer={preview} onClose={() => setPreview(null)} />}
      </>
    );
  }

  return (
    <>
      {receivedModal}
      <div className="global-transfers">
        <div className="gt-head">
          <span className="gt-title">Transfers</span>
          <button className="icon-btn" onClick={() => setDismissed(true)} title="Hide">
            <XIcon size={16} />
          </button>
        </div>

        {callStatus === "connecting" && (
          <div className="status-line" style={{ justifyContent: "flex-start", padding: "4px 0" }}>
            <PulseLine /> Connecting to your contact…
          </div>
        )}
        {callError && (
          <p className="error" style={{ margin: "4px 0", cursor: "pointer" }} onClick={clearCallError}>
            {callError} (dismiss)
          </p>
        )}

        <ul className="file-list">
          {transfers.map((t) => {
            const pct = t.size ? Math.round((t.transferred / t.size) * 100) : 0;
            const done = pct >= 100;
            const canPreview = t.direction === "receive" && done && t.url;
            return (
              <li key={t.id} className="file-row" style={{ display: "block" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <FileIcon size={16} className="file-icon" />
                  <span className="file-meta">
                    <span className="file-name">
                      {canPreview ? (
                        <button className="linklike" onClick={() => setPreview(t)}>
                          {t.name}
                        </button>
                      ) : (
                        `${t.direction === "send" ? "↑" : "↓"} ${t.name || "file"}`
                      )}
                    </span>
                    <span className="file-sub">{done ? formatBytes(t.size) : `${pct}%`}</span>
                  </span>
                  {canPreview && (
                    <a className="file-action" href={t.url} download={t.name} title="Download">
                      <ReceiveIcon size={16} />
                    </a>
                  )}
                </div>
                <div className="progress-track">
                  <div className={`progress-fill ${done ? "done" : ""}`} style={{ width: `${pct}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {preview && <FilePreview transfer={preview} onClose={() => setPreview(null)} />}
    </>
  );
}
