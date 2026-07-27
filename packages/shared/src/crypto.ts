/// <reference lib="dom" />
// Application-layer E2EE for file transfers.
//
// RTCDataChannel is already DTLS-encrypted peer-to-peer, and a TURN relay only
// ever sees ciphertext. The one gap DTLS alone leaves open: the signaling
// server relays the SDP exchange, including each peer's DTLS fingerprint, so a
// malicious signaling server could substitute its own fingerprint on both sides
// and sit in the middle of a connection that looks end-to-end encrypted.
//
// This layer closes that gap ONLY because its key never transits signaling: it
// is derived from a passphrase the sender shares out-of-band. Deriving from the
// room code would not help — signaling already knows the code.
//
// Uses the global WebCrypto (`crypto.subtle`), available in browsers and in
// Node >= 20, so this module is testable without a browser.

const PBKDF2_ITERATIONS = 250_000;
const KEY_LENGTH_BITS = 256;
export const SALT_LENGTH = 16;
export const NONCE_LENGTH = 4; // per-transfer GCM IV prefix
const IV_LENGTH = 12; // 96-bit GCM IV = 4-byte nonce ++ 8-byte big-endian seq

// Derive an AES-GCM key from a passphrase and a per-transfer salt. The salt is
// random and travels in the plaintext manifest — salts aren't secret.
export async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: KEY_LENGTH_BITS },
    false,
    ["encrypt", "decrypt"],
  );
}

export function randomSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
}

export function randomNonce(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(NONCE_LENGTH));
}

// 96-bit GCM IV = 4-byte per-transfer random nonce ++ 8-byte big-endian seq.
// The seq counter guarantees no (key, IV) pair repeats for the life of one
// transfer's key — a fresh-random IV per chunk cannot guarantee that at scale.
export function buildIv(transferNonce: Uint8Array, seq: number): Uint8Array {
  if (transferNonce.length !== NONCE_LENGTH) {
    throw new Error(`transferNonce must be ${NONCE_LENGTH} bytes`);
  }
  const iv = new Uint8Array(IV_LENGTH);
  iv.set(transferNonce, 0);
  writeUint64BE(iv, NONCE_LENGTH, seq);
  return iv;
}

// Authenticated associated data = transferId ++ seq. Binding both into GCM is
// what stops chunks from being reordered or spliced between transfers/positions
// without the auth tag failing — per-chunk encryption alone doesn't guarantee
// ordering integrity.
export function buildAad(transferId: string, seq: number): Uint8Array {
  const idBytes = new TextEncoder().encode(transferId);
  const aad = new Uint8Array(idBytes.length + 8);
  aad.set(idBytes, 0);
  writeUint64BE(aad, idBytes.length, seq);
  return aad;
}

export function encryptChunk(
  key: CryptoKey,
  data: ArrayBuffer,
  iv: Uint8Array,
  aad: Uint8Array,
): Promise<ArrayBuffer> {
  return crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource, additionalData: aad as BufferSource },
    key,
    data,
  );
}

export function decryptChunk(
  key: CryptoKey,
  data: ArrayBuffer,
  iv: Uint8Array,
  aad: Uint8Array,
): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource, additionalData: aad as BufferSource },
    key,
    data,
  );
}

// --- base64 helpers for putting salt/nonce in JSON control messages ---

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

// Write a non-negative safe integer as 8 big-endian bytes without BigInt (a seq
// counter never approaches 2^53, so this is exact and avoids target/lib churn).
function writeUint64BE(target: Uint8Array, offset: number, value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
    throw new Error(`seq out of range: ${value}`);
  }
  let v = value;
  for (let i = 7; i >= 0; i--) {
    target[offset + i] = v & 0xff;
    v = Math.floor(v / 256);
  }
}
