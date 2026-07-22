import { useMemo, useRef, useState } from "react";
import { useContacts } from "../hooks/useContacts";
import { usePresence } from "../presence/PresenceContext";
import { PulseLine } from "./PulseLine";
import { Avatar } from "./Avatar";
import { SendIcon } from "../icons";

// Compact list of accepted contacts, each with a direct Send button that skips
// the code entirely: pick files → presence lookup → WebRTC. Reused on the Send
// view and available anywhere a "send to contact" shortcut is useful.
export function ContactSendList({ onManageContacts }: { onManageContacts?: () => void }) {
  const { data } = useContacts();
  const { online, sendToContact, callStatus } = usePresence();
  const [query, setQuery] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const targetRef = useRef<string | null>(null);

  const accepted = data?.accepted ?? [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return accepted;
    return accepted.filter(
      (c) => c.user.displayName.toLowerCase().includes(q) || (c.user.email ?? "").toLowerCase().includes(q),
    );
  }, [accepted, query]);

  function pickFilesFor(userId: string) {
    targetRef.current = userId;
    fileInputRef.current?.click();
  }

  function onFilesChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (targetRef.current && files.length) sendToContact(targetRef.current, files);
    e.target.value = "";
  }

  return (
    <div className="card">
      <input ref={fileInputRef} type="file" multiple hidden onChange={onFilesChosen} />
      <div className="panel-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>Send to a contact</span>
        <span className="header-status">
          <PulseLine active={online} />
          {online ? "Online" : "Offline"}
        </span>
      </div>

      {accepted.length === 0 ? (
        <div>
          <p className="empty-hint">No contacts yet — add someone to send without a code.</p>
          {onManageContacts && (
            <button className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={onManageContacts}>
              Manage contacts
            </button>
          )}
        </div>
      ) : (
        <>
          {accepted.length > 5 && (
            <input
              className="input"
              placeholder="Search contacts…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ marginBottom: 10 }}
            />
          )}
          <ul className="file-list">
            {filtered.map((c) => (
              <li key={c.user.id} className="file-row hoverable">
                <Avatar id={c.user.id} name={c.user.displayName} />
                <span className="file-meta">
                  <span className="file-name">{c.user.displayName}</span>
                  {c.user.email && <span className="file-sub">{c.user.email}</span>}
                </span>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={!online || callStatus === "connecting"}
                  title={online ? "Send a file — no code needed" : "Connecting…"}
                  onClick={() => pickFilesFor(c.user.id)}
                >
                  <SendIcon size={14} /> Send
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
