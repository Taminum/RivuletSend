import { useEffect, useState } from "react";
import { api, type ApiTransfer } from "../../api";
import type { Transfer } from "../../transfers";
import { formatBytes } from "../../format";
import { SendIcon, ReceiveIcon } from "../../icons";

// Compact right-column strip: the current in-flight send(s) with a live progress
// bar, plus the last couple of completed History entries. Reuses the same
// History data source (api.listTransfers) — no second data model. The live rows
// come from the active session so an in-progress transfer shows here (with
// progress) rather than in a separate live-status card.
export function RecentActivityPanel({ live, refreshKey }: { live: Transfer[]; refreshKey?: number }) {
  const [history, setHistory] = useState<ApiTransfer[]>([]);

  useEffect(() => {
    let alive = true;
    api
      .listTransfers()
      .then(({ transfers }) => {
        if (alive) setHistory(transfers);
      })
      .catch(() => {
        /* offline / not signed in */
      });
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  const inFlight = live.filter((t) => t.direction === "send" && t.size > 0 && t.transferred < t.size);
  const recent = history.slice(0, 2);
  const empty = inFlight.length === 0 && recent.length === 0;

  return (
    <div className="card recent-panel">
      <div className="panel-title">Recent activity</div>
      {empty ? (
        <p className="muted recent-empty">Nothing yet — your transfers show up here.</p>
      ) : (
        <ul className="recent-list">
          {inFlight.map((t) => {
            const pct = Math.round((t.transferred / t.size) * 100);
            return (
              <li key={t.id} className="recent-row">
                <div className="recent-head">
                  <span className="recent-name">
                    <SendIcon size={12} /> {t.name}
                  </span>
                  <span className="recent-sub">{pct}%</span>
                </div>
                <div className="recent-track">
                  <div className="recent-fill" style={{ width: `${pct}%` }} />
                </div>
              </li>
            );
          })}
          {recent.map((t) => (
            <li key={t.id} className="recent-row">
              <div className="recent-head">
                <span className="recent-name">
                  {t.direction === "sent" ? <SendIcon size={12} /> : <ReceiveIcon size={12} />} {t.fileName}
                </span>
                <span className={`recent-sub ${t.status === "failed" ? "failed" : ""}`}>
                  {t.status === "failed" ? "failed" : formatBytes(Number(t.fileSize))}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
