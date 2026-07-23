import type { IncomingFolder } from "./fileTransfer";

export interface Transfer {
  id: string;
  name: string;
  size: number;
  direction: "send" | "receive";
  transferred: number;
  url?: string; // object URL, set on received files once complete
  mimeType?: string; // set on received files, for preview
  savedPath?: string; // set when the desktop shell auto-saved it to disk
}

// A folder transfer shows as a single collapsed row (X of Y files) rather than
// one progress bar per file.
export interface FolderTransfer {
  folderId: string;
  folderName: string;
  direction: "send" | "receive";
  filesDone: number;
  totalFiles: number;
  bytesTransferred: number;
  totalBytes: number;
  done: boolean;
  failed?: boolean;
  reason?: string;
  incoming?: IncomingFolder; // received folder, for save/zip
  savedPath?: string; // set when the desktop shell auto-saved it to disk
}

// Emitted once when a transfer reaches a terminal state (completed OR failed),
// so a signed-in shell can record it to history.
export interface CompletedTransfer {
  id: string;
  name: string;
  size: number;
  direction: "send" | "receive";
  counterpartUserId: string | null;
  status: "completed" | "failed";
  reason?: string; // human-readable, set when status is "failed"
}

// Maps a low-level disconnect code to a human-readable failure reason.
export function failureReasonText(reason?: string): string {
  switch (reason) {
    case "peer_left":
      return "The other device disconnected";
    case "connection_failed":
      return "The connection failed";
    case "connection_closed":
    case "channel_closed":
      return "The connection closed before finishing";
    default:
      return "Interrupted before finishing";
  }
}
