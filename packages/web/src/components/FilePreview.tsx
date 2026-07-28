import { useEffect, useState } from "react";
import type { Transfer } from "../transfers";
import { formatBytes } from "../format";
import { XIcon, CopyIcon, CheckIcon, ReceiveIcon } from "../icons";

const TEXT_EXT = /\.(txt|md|markdown|json|csv|log|xml|ya?ml|ini|conf|sh|js|ts|css|html?)$/i;

type Kind = "image" | "video" | "audio" | "text" | "pdf" | "none";

function kindOf(t: Transfer): Kind {
  const mime = (t.mimeType ?? "").toLowerCase();
  const name = t.name.toLowerCase();
  // SVG is effectively active content — it can carry an embedded <script> — so
  // it is never rendered as an image/preview despite the image/* MIME type.
  if (mime === "image/svg+xml" || name.endsWith(".svg")) return "none";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  // Text renders as escaped plain text (never dangerouslySetInnerHTML), so
  // even .html here is shown as source, not executed.
  if (mime.startsWith("text/") || TEXT_EXT.test(name)) return "text";
  return "none";
}

export function FilePreview({ transfer, onClose }: { transfer: Transfer; onClose: () => void }) {
  const kind = kindOf(transfer);
  const [text, setText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (kind === "text" && transfer.url) {
      fetch(transfer.url)
        .then((r) => r.text())
        .then(setText)
        .catch(() => setText("(could not read file)"));
    }
  }, [kind, transfer.url]);

  function copyText() {
    if (text == null) return;
    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title">
            <div className="file-name">{transfer.name}</div>
            <div className="file-sub">{formatBytes(transfer.size)}</div>
          </div>
          <div className="row-actions">
            {kind === "text" && (
              <button className="btn btn-ghost btn-sm" onClick={copyText}>
                {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />} Copy
              </button>
            )}
            {transfer.url && (
              <a className="btn btn-ghost btn-sm" href={transfer.url} download={transfer.name}>
                <ReceiveIcon size={14} /> Download
              </a>
            )}
            <button className="icon-btn" onClick={onClose} title="Close">
              <XIcon size={18} />
            </button>
          </div>
        </div>

        <div className="modal-body">
          {kind === "image" && transfer.url && (
            <img className="preview-image" src={transfer.url} alt={transfer.name} />
          )}
          {kind === "video" && transfer.url && (
            <video className="preview-media" src={transfer.url} controls />
          )}
          {kind === "audio" && transfer.url && (
            <audio className="preview-media preview-audio" src={transfer.url} controls />
          )}
          {kind === "pdf" && transfer.url && (
            <iframe className="preview-pdf" src={transfer.url} title={transfer.name} />
          )}
          {kind === "text" && <pre className="preview-text">{text ?? "Loading…"}</pre>}
          {kind === "none" && (
            <div className="preview-none">
              <p className="muted">No preview available for this file type.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
