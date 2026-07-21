import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ApiTransfer } from "../api";
import { usePresence } from "../presence/PresenceContext";
import { formatBytes } from "../format";
import { FileIcon, XIcon, SendIcon, CheckIcon } from "../icons";

function relativeTime(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function HistoryPanel({ refreshKey }: { refreshKey: number }) {
  const { online, sendToContact } = usePresence();
  const [transfers, setTransfers] = useState<ApiTransfer[]>([]);
  const [loaded, setLoaded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resendTargetRef = useRef<string | null>(null);

  function resendTo(userId: string) {
    resendTargetRef.current = userId;
    fileInputRef.current?.click();
  }

  function onResendFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (resendTargetRef.current && files.length) sendToContact(resendTargetRef.current, files);
    e.target.value = "";
  }

  const load = useCallback(async () => {
    try {
      const { transfers } = await api.listTransfers();
      setTransfers(transfers);
    } catch {
      /* keep existing */
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function remove(id: string) {
    await api.deleteTransfer(id);
    setTransfers((prev) => prev.filter((t) => t.id !== id));
  }

  if (!loaded) return null;

  return (
    <div className="view">
      <div className="card">
        <input ref={fileInputRef} type="file" multiple hidden onChange={onResendFiles} />
        <div className="panel-title" style={{ display: "flex", justifyContent: "space-between" }}>
          <span>History</span>
          <button className="link-btn" onClick={() => void load()}>
            Refresh
          </button>
        </div>

        {transfers.length === 0 ? (
          <p className="empty-hint">No transfers yet.</p>
        ) : (
          <ul className="file-list">
            {transfers.map((t) => (
              <li key={t.id} className="file-row hoverable">
                <FileIcon size={18} className="file-icon" />
                <span className="file-meta">
                  <span className="file-name">
                    {t.direction === "sent" ? "↑ " : "↓ "}
                    {t.fileName}
                  </span>
                  <span className="file-sub">
                    {formatBytes(Number(t.fileSize))}
                    {t.counterpart
                      ? ` · ${t.direction === "sent" ? "to" : "from"} ${t.counterpart.displayName}`
                      : ""}
                    {` · ${relativeTime(t.createdAt)}`}
                    {t.status === "failed" && (
                      <span className="failed-tag">
                        {" · failed"}
                        {t.failureReason ? ` — ${t.failureReason}` : ""}
                      </span>
                    )}
                  </span>
                </span>
                {t.status === "completed" && (
                  <span className="status-check" title="Completed">
                    <CheckIcon size={14} />
                  </span>
                )}
                <span className="row-actions">
                  {t.counterpart && (
                    <button
                      className="file-action"
                      disabled={!online}
                      onClick={() => resendTo(t.counterpart!.id)}
                      title={online ? `Send a file to ${t.counterpart.displayName}` : "Go online to resend"}
                    >
                      <SendIcon size={15} />
                    </button>
                  )}
                  <button className="file-action" onClick={() => void remove(t.id)} title="Delete">
                    <XIcon size={16} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
