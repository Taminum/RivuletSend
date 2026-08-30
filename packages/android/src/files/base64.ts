// Base64 <-> bytes. react-native-fs only reads/writes binary as base64, but the
// RTCDataChannel carries raw ArrayBuffers (to interoperate byte-for-byte with the
// web/desktop peers), so every chunk is converted at the seam. Self-contained —
// React Native has no global atob/btoa.

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Uint8Array(256);
for (let i = 0; i < CHARS.length; i++) LOOKUP[CHARS.charCodeAt(i)] = i;

export function base64ToBytes(b64: string): Uint8Array {
  let len = b64.length;
  if (len === 0) return new Uint8Array(0);
  let pad = 0;
  if (b64[len - 1] === '=') pad++;
  if (b64[len - 2] === '=') pad++;
  const byteLen = (len * 3) / 4 - pad;
  const out = new Uint8Array(byteLen);
  let p = 0;
  for (let i = 0; i < len; i += 4) {
    const e0 = LOOKUP[b64.charCodeAt(i)];
    const e1 = LOOKUP[b64.charCodeAt(i + 1)];
    const e2 = LOOKUP[b64.charCodeAt(i + 2)];
    const e3 = LOOKUP[b64.charCodeAt(i + 3)];
    if (p < byteLen) out[p++] = (e0 << 2) | (e1 >> 4);
    if (p < byteLen) out[p++] = ((e1 & 15) << 4) | (e2 >> 2);
    if (p < byteLen) out[p++] = ((e2 & 3) << 6) | e3;
  }
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < len ? bytes[i + 1] : 0;
    const b2 = i + 2 < len ? bytes[i + 2] : 0;
    out += CHARS[b0 >> 2];
    out += CHARS[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < len ? CHARS[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < len ? CHARS[b2 & 63] : '=';
  }
  return out;
}
