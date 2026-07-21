// Fixed-window per-IP limiter for room creation. In-memory is fine for a
// single-process MVP; move to Redis if signaling is ever scaled horizontally.
const WINDOW_MS = 60_000;
const MAX_CREATES_PER_WINDOW = 10;

const windows = new Map<string, { count: number; windowStart: number }>();

export function allowRoomCreate(ip: string): boolean {
  const now = Date.now();
  const entry = windows.get(ip);

  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    windows.set(ip, { count: 1, windowStart: now });
    return true;
  }

  if (entry.count >= MAX_CREATES_PER_WINDOW) {
    return false;
  }

  entry.count += 1;
  return true;
}

// Periodically drop stale entries so the map doesn't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of windows) {
    if (now - entry.windowStart >= WINDOW_MS) windows.delete(ip);
  }
}, WINDOW_MS).unref();
