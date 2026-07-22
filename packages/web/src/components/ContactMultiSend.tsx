import { useState } from "react";
import { useContacts } from "../hooks/useContacts";
import { usePresence } from "../presence/PresenceContext";
import { Avatar } from "./Avatar";
import { SendIcon, CheckIcon } from "../icons";

// Multi-select contact sender shown on the active-send screen: pick one or more
// contacts and deliver the same staged files to each (the presence peer runs
// them sequentially; per-contact status comes from `contactSendState`).
const PHASE_LABEL: Record<string, string> = {
  queued: "Queued",
  sending: "Sending…",
  sent: "Sent",
  failed: "Failed",
};
const PHASE_CLASS: Record<string, string> = {
  queued: "muted",
  sending: "progress",
  sent: "ok",
  failed: "failed",
};

export function ContactMultiSend({ files }: { files: File[] }) {
  const { data } = useContacts();
  const { isContactOnline, sendToContacts, contactSendState, callStatus } = usePresence();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const accepted = data?.accepted ?? [];
  if (accepted.length === 0) return null;

  const busy = callStatus !== "idle";
  // Only online contacts can actually receive a direct send.
  const selectedOnline = [...selected].filter((id) => isContactOnline(id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function send() {
    if (selectedOnline.length === 0 || files.length === 0) return;
    sendToContacts(selectedOnline, files);
  }

  return (
    <div className="card">
      <div className="panel-title">Send to contacts</div>
      <p className="muted" style={{ marginTop: -6, marginBottom: 12 }}>
        Select one or more online contacts to send these files to directly — no code needed.
      </p>

      <ul className="file-list">
        {accepted.map((c) => {
          const phase = contactSendState[c.user.id];
          const contactOnline = isContactOnline(c.user.id);
          const checked = selected.has(c.user.id);
          const selectable = contactOnline && !busy;
          return (
            <li
              key={c.user.id}
              className={`file-row hoverable ${contactOnline ? "" : "row-offline"}`}
              onClick={() => selectable && toggle(c.user.id)}
              style={{ cursor: selectable ? "pointer" : "default" }}
            >
              <span className={`ms-check ${checked ? "on" : ""} ${contactOnline ? "" : "disabled"}`} aria-hidden>
                {checked && contactOnline && <CheckIcon size={12} />}
              </span>
              <Avatar id={c.user.id} name={c.user.displayName} online={contactOnline} />
              <span className="file-meta">
                <span className="file-name">{c.user.displayName}</span>
                <span className={`file-sub ${contactOnline ? "online-tag" : ""}`}>
                  {contactOnline ? "Online" : "Offline"}
                </span>
              </span>
              {phase && <span className={`hist-status ${PHASE_CLASS[phase]}`}>{PHASE_LABEL[phase]}</span>}
            </li>
          );
        })}
      </ul>

      <button
        className="btn btn-primary btn-block"
        style={{ marginTop: 14 }}
        disabled={selectedOnline.length === 0 || busy}
        onClick={send}
      >
        <SendIcon size={15} />
        {busy
          ? "Sending…"
          : selectedOnline.length > 0
            ? `Send to ${selectedOnline.length} contact${selectedOnline.length > 1 ? "s" : ""}`
            : "Send to contacts"}
      </button>
    </div>
  );
}
