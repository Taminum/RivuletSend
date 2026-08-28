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
import { PeerBeam } from "./PeerBeam";
import { TransferSpeedometer } from "./TransferSpeedometer";
import { TrustPanel } from "./send/TrustPanel";
import { RecentActivityPanel } from "./send/RecentActivityPanel";
import { CloudUploadIcon, FileIcon, CopyIcon, CheckIcon, ShareIcon } from "../icons";
import { useWakeLock } from "../wakeLock";
import { useTransferTitle } from "../transferTitle";

type Mode = "files" | "text";
type NavTarget = "contacts" | "settings";

// Whether the advanced-options disclosure is expanded. Session-only (module
// scope, not persisted): staying open across files in one session is fine, but
// it shouldn't become a saved default that reintroduces the clutter for everyone.
let advPanelOpenSession = false;

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
  const { connected, connectionType, transfers, folders, error, createRoom, sendFiles, sendFolder, reset, setPassphrase } =
    useTransferSession(onComplete);
  const [code, setCode] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [isFolder, setIsFolder] = useState(false);
  const [text, setText] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [copied, setCopied] = useState(false);
  const [passphrase, setPassphraseInput] = useState("");
  const [burnAfterRead, setBurnAfterRead] = useState(false);
  const [advOpen, setAdvOpen] = useState(advPanelOpenSession);
  const [qrOpen, setQrOpen] = useState(false);
  const pendingRef = useRef<File[]>([]);
  const pendingFolderRef = useRef<FolderSelection | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const dropzoneRef = useRef<HTMLDivElement>(null);

  // Push the passphrase down to the session (never sent over the wire).
  useEffect(() => {
    setPassphrase(passphrase.trim() || null);
  }, [passphrase, setPassphrase]);

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

  // Paste-to-send: Ctrl+V an image/file (e.g. a screenshot) to start a transfer.
  // Only when the Send view is actually visible (it stays mounted-but-hidden on
  // other tabs), on the files tab with no code yet, and not while typing in a field.
  useEffect(() => {
    if (mode !== "files" || code) return;
    const onPaste = (e: ClipboardEvent) => {
      if (dropzoneRef.current?.offsetParent == null) return; // hidden tab
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const pasted = Array.from(e.clipboardData?.files ?? []);
      if (pasted.length) {
        e.preventDefault();
        void startWith(pasted);
      }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, code]);

  function toggleAdv() {
    const next = !advOpen;
    setAdvOpen(next);
    advPanelOpenSession = next;
  }

  async function startWith(selected: File[]) {
    if (!selected.length || code) return;
    setFiles(selected);
    setIsFolder(false);
    pendingRef.current = selected;
    try {
      setCode(await createRoom(burnAfterRead));
    } catch {
      /* error surfaced via hook */
    }
  }

  async function startFolder(sel: FolderSelection) {
    if (!sel.entries.length || code) return;
    setIsFolder(true);
    pendingFolderRef.current = sel;
    try {
      setCode(await createRoom(burnAfterRead));
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

  // --- Derived transfer state (meaningful only once a code exists) ---
  const joinUrl = code ? `${window.location.origin}${window.location.pathname}#receive=${code}` : "";

  // Native OS share sheet for the code + join link. Deliberately never carries
  // the passphrase — that has to travel a separate channel (see the E2EE work),
  // and the Share button is hidden entirely when a passphrase is set.
  async function shareCode() {
    try {
      await navigator.share({
        title: "OwlSend",
        text: `Here's a file for you — code: ${code}`,
        url: joinUrl,
      });
    } catch (err) {
      if ((err as DOMException)?.name !== "AbortError") {
        /* real failures here are rare and not worth surfacing as an error
           banner — Copy is right next to it as a working fallback */
      }
    }
  }
  const allDone = isFolder
    ? folders.length > 0 && folders.every((f) => f.done || f.failed)
    : transfers.length > 0 && transfers.every((t) => t.size > 0 && t.transferred >= t.size);
  const inFlight = transfers.filter((t) => t.direction === "send" && t.size > 0 && t.transferred < t.size);
  const sendActive = inFlight.length > 0;
  const sendTotal = inFlight.reduce((s, t) => s + t.size, 0);
  const sendDone = inFlight.reduce((s, t) => s + t.transferred, 0);
  useWakeLock(sendActive);
  useTransferTitle("room-send", sendActive, sendTotal > 0 ? (sendDone / sendTotal) * 100 : 0, "up");
  const anyRate = inFlight.some((t) => t.speed != null);
  const aggRate = anyRate ? inFlight.reduce((s, t) => s + (t.speed ?? 0), 0) : null;
  const remaining = inFlight.reduce((s, t) => s + (t.size - t.transferred), 0);
  const etaSeconds = aggRate && aggRate > 0 ? remaining / aggRate : null;
  const rateHistory = inFlight[0]?.rateHistory;
  const showSpeed = Boolean(code) && connected && !allDone && inFlight.length > 0;

  const shareCard = code ? (
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
        {typeof navigator.share === "function" && !passphrase && (
          <button className="btn btn-ghost btn-sm" onClick={shareCode}>
            <ShareIcon size={14} /> Share
          </button>
        )}
      </div>
      <button className="qr-block qr-open" onClick={() => setQrOpen(true)} title="Tap to enlarge">
        <QrCode text={joinUrl} size={128} />
        <span className="muted">Scan to receive on a phone — tap to enlarge</span>
      </button>
      {qrOpen && (
        <div className="qr-overlay" onClick={() => setQrOpen(false)} role="dialog" aria-label="Scan QR code">
          <div className="qr-overlay-card" onClick={(e) => e.stopPropagation()}>
            <QrCode text={joinUrl} size={280} />
            <div className="share-code big" style={{ marginTop: 8 }}>{code}</div>
            <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => setQrOpen(false)}>
              Close
            </button>
          </div>
        </div>
      )}
      <div style={{ marginTop: 20 }}>
        <PeerBeam state={!connected ? "waiting" : allDone ? "done" : "transferring"} />
      </div>
      {connected && connectionType !== "unknown" && (
        <div className={`conn-badge ${connectionType === "relay" ? "relay" : "direct"}`} style={{ marginTop: 12 }}>
          {connectionType === "relay"
            ? "⚠ Relayed via server — slower (direct P2P didn't connect)"
            : connectionType === "direct-local"
              ? "Direct · local network"
              : "Direct connection"}
        </div>
      )}
      {connected && !allDone && (
        <p className="muted" style={{ marginTop: 14, fontSize: 12.5, textAlign: "center" }}>
          Reconnects automatically if the connection drops — closing the tab cancels the transfer.
        </p>
      )}
    </div>
  ) : null;

  const foldersCard =
    folders.length > 0 ? (
      <div className="card">
        <ul className="file-list">
          {folders.map((f) => (
            <FolderRow key={f.folderId} folder={f} />
          ))}
        </ul>
      </div>
    ) : null;

  const filesProgress = (
    <ul className="file-list">
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
  );

  // --- Text mode, before a link exists: single column ---
  if (mode === "text" && !code) {
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

  // --- Files mode (and any active session): two-column layout ---
  return (
    <div className="send-2col">
      <div className="send-main">
        {code ? (
          <>
            {/* Signed-in keeps the code/QR here (right column shows the cards);
                a guest's code/QR lives in the right column instead. */}
            {user && shareCard}
            {foldersCard}
            {/* Guest: per-file progress here. Signed-in: it shows once, live, in
                Recent activity (right) — not duplicated. */}
            {!user && !isFolder && files.length > 0 && <div className="card">{filesProgress}</div>}
            {showSpeed && (
              <TransferSpeedometer rate={aggRate} etaSeconds={etaSeconds} history={rateHistory} />
            )}
            {user && !isFolder && files.length > 0 && <ContactMultiSend files={files} />}
            {error && <p className="error">{error}</p>}
            <button className="btn btn-ghost" onClick={newTransfer}>
              New transfer
            </button>
          </>
        ) : (
          <>
            <div
              ref={dropzoneRef}
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

            {/* Advanced options, collapsed by default. */}
            <div className="adv">
              <button className="adv-toggle" onClick={toggleAdv} aria-expanded={advOpen}>
                <span className={`ft-chevron ${advOpen ? "open" : ""}`}>▸</span>
                Advanced options — passphrase, one-time link
              </button>
              {advOpen && (
                <div className="adv-body">
                  <label className="section-label" htmlFor="passphrase">
                    Encrypt with a passphrase (optional)
                  </label>
                  <input
                    id="passphrase"
                    className="input"
                    type="text"
                    autoComplete="off"
                    placeholder="Leave blank for none"
                    value={passphrase}
                    onChange={(e) => setPassphraseInput(e.target.value)}
                  />
                  <p className="muted" style={{ marginTop: 8, fontSize: 12.5 }}>
                    End-to-end encrypts the file and its name. Tell the recipient the passphrase through a{" "}
                    <strong>different channel</strong> — sending it with the code defeats the purpose.
                    Applies to single files (not folders).
                  </p>

                  <label className="burn-check" style={{ marginTop: 14 }}>
                    <input
                      type="checkbox"
                      checked={burnAfterRead}
                      onChange={(e) => setBurnAfterRead(e.target.checked)}
                    />
                    <span>
                      <span className="file-name">Close this link after it's downloaded once</span>
                      <span className="file-sub">
                        The code stops working as soon as one transfer completes.
                      </span>
                    </span>
                  </label>
                </div>
              )}
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
                ? "Drop files or a folder to get a shareable code — or send straight to a device/contact on the right."
                : "Drop files or a folder to get a one-time code you can share with anyone."}
            </p>

            {!user && (
              <div className="card nudge">
                <span className="muted">Sign in to send files straight to a contact — no code needed.</span>
                <button className="btn btn-ghost btn-sm" onClick={() => onNavigate?.("settings")}>
                  Sign in
                </button>
              </div>
            )}

            {error && <p className="error">{error}</p>}
          </>
        )}
      </div>

      <aside className="send-side">
        {!user ? (
          code ? (
            shareCard
          ) : (
            <TrustPanel />
          )
        ) : (
          <>
            <MyDevicesSend onManage={() => onNavigate?.("settings")} />
            <ContactSendList onManageContacts={() => onNavigate?.("contacts")} />
            <RecentActivityPanel live={transfers} />
          </>
        )}
      </aside>
    </div>
  );
}
