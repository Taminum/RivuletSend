import { useState } from "react";
import type { FolderTransfer } from "../transfers";
import { canSaveFolder, saveFolderToDisk, downloadFolderAsZip } from "../fileTransfer";
import { formatBytes } from "../format";
import { FolderIcon } from "../icons";
import { FolderTree } from "./FolderTree";

// One collapsed row for a whole folder transfer ("photos/ — 12 of 47 files"),
// expandable into a read-only tree of its files.
export function FolderRow({ folder }: { folder: FolderTransfer }) {
  const [busy, setBusy] = useState(false);
  const [showTree, setShowTree] = useState(false);
  const hasTree = Boolean(folder.entries?.length);
  const pct = folder.failed
    ? 100
    : folder.totalBytes
      ? Math.round((folder.bytesTransferred / folder.totalBytes) * 100)
      : folder.done
        ? 100
        : 0;
  const done = folder.done && !folder.failed;
  const canReceiveActions = done && folder.direction === "receive" && folder.incoming;

  async function save() {
    if (!folder.incoming) return;
    setBusy(true);
    try {
      await saveFolderToDisk(folder.incoming);
    } catch {
      /* user cancelled or write failed */
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="file-row" style={{ display: "block" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
        <FolderIcon size={18} className="file-icon" />
        <span className="file-meta">
          <span className="file-name">
            {folder.direction === "send" ? "↑ " : "↓ "}
            {folder.folderName}/
          </span>
          <span className="file-sub">
            {folder.filesDone} of {folder.totalFiles} files ·{" "}
            {folder.done ? formatBytes(folder.totalBytes) : `${formatBytes(folder.bytesTransferred)} / ${formatBytes(folder.totalBytes)}`}
            {folder.failed && <span className="failed-tag"> · failed — {folder.reason}</span>}
          </span>
        </span>
        {hasTree && (
          <button
            className="link-btn"
            onClick={() => setShowTree((s) => !s)}
            title={showTree ? "Hide files" : "Show files"}
          >
            {showTree ? "Hide files" : "Show files"}
          </button>
        )}
        {canReceiveActions && (
          <span className="row-actions">
            {canSaveFolder && (
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void save()} title="Save the real folder tree to disk">
                Save to folder
              </button>
            )}
            <button className="btn btn-ghost btn-sm" onClick={() => void downloadFolderAsZip(folder.incoming!)}>
              Download .zip
            </button>
          </span>
        )}
      </div>
      <div className="progress-track">
        <div
          className={`progress-fill ${done ? "done" : ""} ${folder.failed ? "failed" : ""}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showTree && hasTree && <FolderTree folder={folder} />}
    </li>
  );
}
