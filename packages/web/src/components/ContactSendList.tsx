import { useMemo, useRef, useState } from "react";
import { useContacts } from "../hooks/useContacts";
import { usePresence } from "../presence/PresenceContext";
import { selectionFromInputFiles } from "../folderSelect";
import { PulseLine } from "./PulseLine";
import { Avatar } from "./Avatar";
import { SendIcon, FolderIcon } from "../icons";

// Compact list of accepted contacts, each with a direct Send button that skips
// the code entirely: pick files → presence lookup → WebRTC. Reused on the Send
// view and available anywhere a "send to contact" shortcut is useful.
export function ContactSendList({ onManageContacts }: { onManageContacts?: () => void }) {
  const { data } = useContacts();
  const { online, isContactOnline, sendToContact, sendFolderToContact, callStatus } = usePresence();
  const [query, setQuery] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
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

  async function pickFolderFor(userId: string) {
    const native = typeof window !== "undefined" ? window.rivulet : undefined;
    if (native?.isDesktop && native.pickFolder) {
      const sel = await native.pickFolder();
      if (sel?.entries?.length) sendFolderToContact(userId, sel.folderName, sel.entries);
      return;
    }
    targetRef.current = userId;
    folderInputRef.current?.click();
  }
  function onFolderChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(e.target.files ?? []);
    if (targetRef.current && chosen.length) {
      const sel = selectionFromInputFiles(chosen);
      sendFolderToContact(targetRef.current, sel.folderName, sel.entries);
    }
    e.target.value = "";
  }

  return (
    <div className="card">
      <input ref={fileInputRef} type="file" multiple hidden onChange={onFilesChosen} />
      <input
        ref={folderInputRef}
        type="file"
        hidden
        {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
        onChange={onFolderChosen}
      />
      <div className="panel-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>Send to a contact</span>
        <span className="header-status">
          <PulseLine active={online} />
          {online ? "You're online" : "You're offline"}
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
            {filtered.map((c) => {
              const contactOnline = isContactOnline(c.user.id);
              return (
                <li key={c.user.id} className="file-row hoverable">
                  <Avatar id={c.user.id} name={c.user.displayName} online={contactOnline} />
                  <span className="file-meta">
                    {/* Email lives in the tooltip — the row line shows presence. */}
                    <span className="file-name" title={c.user.email ?? undefined}>
                      {c.user.displayName}
                    </span>
                    <span className={`file-sub ${contactOnline ? "online-tag" : ""}`}>
                      {contactOnline ? "Online" : "Offline"}
                    </span>
                  </span>
                  <span className="row-actions">
                    <button
                      className="icon-btn"
                      disabled={!contactOnline || callStatus === "connecting"}
                      title={contactOnline ? "Pick a folder — no code needed" : "Offline"}
                      aria-label="Pick a folder"
                      onClick={() => void pickFolderFor(c.user.id)}
                    >
                      <FolderIcon size={16} />
                    </button>
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={!contactOnline || callStatus === "connecting"}
                      title={contactOnline ? "Send files — no code needed" : "Offline — can't send directly"}
                      onClick={() => pickFilesFor(c.user.id)}
                    >
                      <SendIcon size={14} /> Send
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
