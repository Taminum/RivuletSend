import { useEffect, useRef, useState } from "react";
import { usePresence } from "../presence/PresenceContext";
import type { Transfer } from "../transfers";
import { formatBytes } from "../format";
import { FilePreview } from "./FilePreview";
import { FolderRow } from "./FolderRow";
import { PulseLine } from "./PulseLine";
import { FileIcon, XIcon, ReceiveIcon } from "../icons";
import { useWakeLock } from "../wakeLock";
import { useTransferTitle } from "../transferTitle";
import { onFileDragStart } from "../dragOut";

// Floating panel that surfaces contact (presence) transfers from anywhere in the
// app, so an incoming file is visible no matter which view you're on.
export function GlobalTransfers() {
  const { transfers, folders, callStatus, connectionType, callError, clearCallError } = usePresence();
  const [dismissed, setDismissed] = useState(false);
  const [preview, setPreview] = useState<Transfer | null>(null);
  const [received, setReceived] = useState<Transfer[]>([]);
  const announcedRef = useRef<Set<string>>(new Set());
  const prevCount = useRef(0);

  // Keep the screen awake and show progress in the tab title while a contact
  // transfer is in flight.
  const inFlight = transfers.filter((t) => t.size > 0 && t.transferred < t.size);
  const active = inFlight.length > 0;
  const totalSize = inFlight.reduce((s, t) => s + t.size, 0);
  const done = inFlight.reduce((s, t) => s + t.transferred, 0);
  const pct = totalSize > 0 ? (done / totalSize) * 100 : 0;
  const dir = inFlight.some((t) => t.direction === "receive") ? "down" : "up";
  useWakeLock(active);
  useTransferTitle("contact", active, pct, dir);

  // A new transfer (file or folder) re-opens the panel even if dismissed.
  useEffect(() => {
    const count = transfers.length + folders.length;
    if (count > prevCount.current) setDismissed(false);
    prevCount.current = count;
  }, [transfers.length, folders.length]);

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

  const hasContent =
    transfers.length > 0 ||
    folders.length > 0 ||
    callStatus === "connecting" ||
    callStatus === "reconnecting" ||
    !!callError;
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

        {(callStatus === "connecting" || callStatus === "reconnecting") && (
          <div className="status-line" style={{ justifyContent: "flex-start", padding: "4px 0" }}>
            <PulseLine />{" "}
            {callStatus === "connecting"
              ? "Connecting to your contact…"
              : "Reconnecting — resuming the transfer…"}
          </div>
        )}
        {active && connectionType !== "unknown" && (
          <div className={`conn-badge ${connectionType === "relay" ? "relay" : "direct"}`}>
            {connectionType === "relay"
              ? "⚠ Relayed via server — slower (direct P2P didn't connect)"
              : connectionType === "direct-local"
                ? "Direct · local network"
                : "Direct connection"}
          </div>
        )}
        {callError && (
          <p className="error" style={{ margin: "4px 0", cursor: "pointer" }} onClick={clearCallError}>
            {callError} (dismiss)
          </p>
        )}

        <ul className="file-list">
          {folders.map((f) => (
            <FolderRow key={f.folderId} folder={f} />
          ))}
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
                    <a
                      className="file-action"
                      href={t.url}
                      download={t.name}
                      title="Download (or drag me to a folder)"
                      draggable
                      onDragStart={(e) => onFileDragStart(e, t)}
                    >
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
