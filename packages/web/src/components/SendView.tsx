import { useEffect, useRef, useState } from "react";
import type { CompletedTransfer } from "../transfers";
import { useTransferSession } from "../hooks/useTransferSession";
import { useAuth } from "../auth/AuthContext";
import { formatBytes } from "../format";
import { selectionFromDrop, selectionFromInputFiles, type FolderSelection } from "../folderSelect";
import { QrCode } from "./QrCode";
import { ContactSendList } from "./ContactSendList";
import { ContactMultiSend } from "./ContactMultiSend";
import { MyDevicesSend } from "./MyDevicesSend";
import { FolderRow } from "./FolderRow";
import { PulseLine } from "./PulseLine";
import { CloudUploadIcon, FileIcon, CopyIcon, CheckIcon } from "../icons";

type Mode = "files" | "text";
type NavTarget = "contacts" | "settings";

export function SendView({
  mode,
  onComplete,
  onNavigate,
}: {
  mode: Mode;
  onComplete?: (t: CompletedTransfer) => void;
  onNavigate?: (view: NavTarget) => void;
}) {
  const { user } = useAuth();
  const { connected, transfers, folders, error, createRoom, sendFiles, sendFolder, reset } =
    useTransferSession(onComplete);
  const [code, setCode] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [isFolder, setIsFolder] = useState(false);
  const [text, setText] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [copied, setCopied] = useState(false);
  const pendingRef = useRef<File[]>([]);
  const pendingFolderRef = useRef<FolderSelection | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Once the receiver connects, push the staged files/folder.
  useEffect(() => {
    if (!connected) return;
    if (pendingFolderRef.current) {
      const sel = pendingFolderRef.current;
      pendingFolderRef.current = null;
      void sendFolder(sel.folderName, sel.entries);
    } else if (pendingRef.current.length) {
      const p = pendingRef.current;
      pendingRef.current = [];
      void sendFiles(p);
    }
  }, [connected, sendFiles, sendFolder]);

  async function startWith(selected: File[]) {
    if (!selected.length || code) return;
    setFiles(selected);
    setIsFolder(false);
    pendingRef.current = selected;
    try {
      setCode(await createRoom());
    } catch {
      /* error surfaced via hook */
    }
  }

  async function startFolder(sel: FolderSelection) {
    if (!sel.entries.length || code) return;
    setIsFolder(true);
    pendingFolderRef.current = sel;
    try {
      setCode(await createRoom());
    } catch {
      /* surfaced via hook */
    }
  }

  function startText() {
    if (!text.trim() || code) return;
    const file = new File([text], "message.txt", { type: "text/plain" });
    void startWith([file]);
  }

  function newTransfer() {
    reset();
    setCode(null);
    setFiles([]);
    setIsFolder(false);
    setText("");
    pendingRef.current = [];
    pendingFolderRef.current = null;
  }

  function copyCode() {
    if (!code) return;
    navigator.clipboard?.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  // --- Active session: show code + QR + progress ---
  if (code) {
    const joinUrl = `${window.location.origin}${window.location.pathname}#receive=${code}`;
    const allDone = isFolder
      ? folders.length > 0 && folders.every((f) => f.done || f.failed)
      : transfers.length > 0 && transfers.every((t) => t.size > 0 && t.transferred >= t.size);
    return (
      <div className="view">
        <div className="card share">
          <div className="share-code-box">
            <div className="share-label">Your one-time code</div>
            <span className="share-code big" onClick={copyCode} title="Click to copy">
              {code}
            </span>
            <button className="btn btn-primary btn-sm" onClick={copyCode}>
              {copied ? (
                <>
                  <CheckIcon size={14} /> Copied
                </>
              ) : (
                <>
                  <CopyIcon size={14} /> Copy code
                </>
              )}
            </button>
          </div>

          <div className="qr-block">
            <QrCode text={joinUrl} size={128} />
            <span className="muted">Scan to open the receive link on a phone</span>
          </div>

          <div className="status-line" style={{ marginTop: 18 }}>
            {connected ? (
              allDone ? (
                isFolder ? "Done — folder sent" : "Done — files sent"
              ) : (
                <>
                  <PulseLine /> Connected — sending…
                </>
              )
            ) : (
              <>
                <PulseLine /> Waiting for the receiver…
              </>
            )}
          </div>
        </div>

        <div className="card">
          <ul className="file-list">
            {folders.map((f) => (
              <FolderRow key={f.folderId} folder={f} />
            ))}
            {files.map((f, i) => {
              const t = transfers.find((x) => x.name === f.name && x.direction === "send");
              const pct = t && t.size ? Math.round((t.transferred / t.size) * 100) : 0;
              const done = pct >= 100;
              return (
                <li key={i} className="file-row" style={{ display: "block" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                    <FileIcon size={18} className="file-icon" />
                    <span className="file-meta">
                      <span className="file-name">{f.name}</span>
                      <span className="file-sub">{done ? formatBytes(f.size) : `${pct}%`}</span>
                    </span>
                  </div>
                  <div className="progress-track">
                    <div className={`progress-fill ${done ? "done" : ""}`} style={{ width: `${pct}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        {user && !isFolder && files.length > 0 && <ContactMultiSend files={files} />}

        {error && <p className="error">{error}</p>}
        <button className="btn btn-ghost" onClick={newTransfer}>
          New transfer
        </button>
      </div>
    );
  }

  // --- Text mode ---
  if (mode === "text") {
    return (
      <div className="view">
        <div className="card">
          <textarea
            className="input"
            placeholder="Type or paste text to send…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button
            className="btn btn-primary btn-block"
            style={{ marginTop: 14 }}
            disabled={!text.trim()}
            onClick={startText}
          >
            Create share link
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  // --- Files mode: dropzone (files or a whole folder) ---
  return (
    <div className="view">
      <div
        className={`dropzone ${dragOver ? "drag-over" : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const dt = e.dataTransfer;
          const dropped = Array.from(dt.files);
          void (async () => {
            const sel = await selectionFromDrop(dt);
            if (sel) void startFolder(sel);
            else void startWith(dropped);
          })();
        }}
      >
        <div className="dz-icon">
          <CloudUploadIcon size={24} />
        </div>
        <div className="dz-title">Drop files or a folder</div>
        <div className="dz-sub">
          or{" "}
          <a
            onClick={(e) => {
              e.stopPropagation();
              inputRef.current?.click();
            }}
          >
            browse files
          </a>
          {" · "}
          <a
            onClick={(e) => {
              e.stopPropagation();
              folderInputRef.current?.click();
            }}
          >
            send a folder
          </a>
        </div>
      </div>

      {/* Hidden pickers live OUTSIDE the dropzone on purpose: clicking one
          programmatically dispatches a click that would otherwise bubble into
          the dropzone's onClick and pop the files dialog on top of this one. */}
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          void startWith(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        hidden
        {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
        onChange={(e) => {
          const chosen = Array.from(e.target.files ?? []);
          if (chosen.length) void startFolder(selectionFromInputFiles(chosen));
          e.target.value = "";
        }}
      />

      <p className="hint-line">
        {user
          ? "Drop files or a folder to get a shareable code — or send straight to a contact below."
          : "Drop files or a folder to get a one-time code you can share with anyone."}
      </p>

      {user && <MyDevicesSend />}

      {user ? (
        <ContactSendList onManageContacts={() => onNavigate?.("contacts")} />
      ) : (
        <div className="card nudge">
          <span className="muted">Sign in to send files straight to a contact — no code needed.</span>
          <button className="btn btn-ghost btn-sm" onClick={() => onNavigate?.("settings")}>
            Sign in
          </button>
        </div>
      )}

      {error && <p className="error">{error}</p>}
    </div>
  );
}
