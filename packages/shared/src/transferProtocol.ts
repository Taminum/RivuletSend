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

// Encryption metadata carried in plaintext alongside an encrypted transfer.
// Salt and nonce are not secret — only the passphrase is — so shipping them in
// the clear is not a weakening (see packages/shared/src/crypto.ts). When absent,
// the transfer is not application-layer encrypted (DTLS still applies).
export interface CryptoHeader {
  // base64 of the 16-byte PBKDF2 salt (per transfer).
  salt: string;
  // base64 of the 4-byte per-transfer GCM nonce prefix.
  nonce: string;
}

export type DataChannelMessage =
  // Sent once at the start of a folder transfer, before any file bytes, so the
  // receiver knows the full file list + relative paths up front.
  | { type: "manifest"; folderName: string; entries: ManifestEntry[]; crypto?: CryptoHeader }
  // `name` is empty and `encName` (base64 ciphertext of the UTF-8 name, seq -1)
  // carries it when the transfer is encrypted, so the filename isn't left in
  // plaintext. `crypto` rides on a single-file (non-folder) start.
  | { type: "file-start"; id: string; name: string; size: number; mimeType: string; encName?: string; crypto?: CryptoHeader }
  | { type: "chunk"; id: string; seq: number }
  | { type: "file-end"; id: string }
  // --- Resumable transfer control (same-session ICE-restart reconnects) ---
  // Receiver -> sender: highest seq received with NO gap before it. Not the
  // latest seq seen: out-of-order chunks in flight when a connection drops mean
  // "latest seen" and "safe to resume from" differ.
  | { type: "chunk-ack"; id: string; contiguousSeq: number }
  // Receiver -> sender after a reconnect: resume this file from seq `fromSeq`.
  | { type: "resume-request"; id: string; fromSeq: number }
  // Sender -> receiver: whether it will resume, and the seq it will resume from.
  | { type: "resume-response"; id: string; accepted: boolean; fromSeq: number };
