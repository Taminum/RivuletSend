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
  const prevCount = useRef(0);

  // A new transfer re-opens the panel even if previously dismissed.
  useEffect(() => {
    if (transfers.length > prevCount.current) setDismissed(false);
    prevCount.current = transfers.length;
  }, [transfers.length]);

  const hasContent = transfers.length > 0 || callStatus === "connecting" || !!callError;
  if (!hasContent || dismissed) {
    return preview ? <FilePreview transfer={preview} onClose={() => setPreview(null)} /> : null;
  }

  return (
    <>
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
