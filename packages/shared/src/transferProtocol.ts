// Messages exchanged over the RTCDataChannel once peers are connected.
// RTCDataChannel already delivers discrete messages, so binary chunks are sent
// as their own message immediately after the `chunk` header — no manual framing needed.

export const CHUNK_SIZE = 64 * 1024; // 64KB

// One entry per file in a folder transfer. `id` ties the per-file file-start/
// chunk/file-end messages back to this entry (and its relativePath).
export interface ManifestEntry {
  id: string;
  relativePath: string;
  size: number;
}

export type DataChannelMessage =
  // Sent once at the start of a folder transfer, before any file bytes, so the
  // receiver knows the full file list + relative paths up front.
  | { type: "manifest"; folderName: string; entries: ManifestEntry[] }
  | { type: "file-start"; id: string; name: string; size: number; mimeType: string }
  | { type: "chunk"; id: string; seq: number }
  | { type: "file-end"; id: string };
