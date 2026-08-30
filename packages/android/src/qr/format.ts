// The web app encodes its join QR as `<origin>/#receive=<CODE>` and decodes any
// scanned string with /receive=([A-Za-z0-9]+)/ (falling back to the raw value).
// Match both sides so phone<->web QR scanning interoperates.
const RECEIVE_BASE = 'https://send.tarmalion.ru/#receive=';

export function codeToQrValue(code: string): string {
  return RECEIVE_BASE + code;
}

export function extractCode(raw: string): string {
  const m = raw.match(/receive=([A-Za-z0-9]+)/);
  return (m ? m[1] : raw).trim().toUpperCase();
}
