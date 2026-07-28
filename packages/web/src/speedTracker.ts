// Smoothed transfer-rate tracker: a rolling window rather than a single
// instantaneous bytes/sec sample (which jumps around too much to read), plus a
// short history of rate points for a sparkline.

const WINDOW_MS = 2000; // rate is averaged over the last 2 seconds
const CALIBRATION_MS = 1000; // show "calculating…" until this much data exists
const HISTORY_INTERVAL_MS = 500; // one sparkline point every 0.5s
const HISTORY_MAX = 60; // ~30 seconds of points

export class SpeedTracker {
  private samples: { t: number; bytes: number }[] = [];
  private startedAt = 0;
  private lastHistoryAt = 0;
  // Recent rate samples (bytes/sec), oldest first — for the sparkline.
  history: number[] = [];

  // Discard everything (used on a resume so the pre-disconnect rate doesn't
  // linger and show a stale number for the first seconds after reconnecting).
  reset(): void {
    this.samples = [];
    this.startedAt = 0;
    this.lastHistoryAt = 0;
    this.history = [];
  }

  // Record cumulative bytes transferred; returns the smoothed rate (bytes/sec),
  // or null while still calibrating (too little data to be meaningful yet).
  sample(bytes: number, now: number = performance.now()): number | null {
    if (this.startedAt === 0) this.startedAt = now;
    this.samples.push({ t: now, bytes });
    const cutoff = now - WINDOW_MS;
    while (this.samples.length > 2 && this.samples[0].t < cutoff) this.samples.shift();

    const rate = this.rate(now);
    if (rate != null && now - this.lastHistoryAt >= HISTORY_INTERVAL_MS) {
      this.lastHistoryAt = now;
      this.history.push(rate);
      if (this.history.length > HISTORY_MAX) this.history.shift();
    }
    return rate;
  }

  private rate(now: number): number | null {
    if (this.startedAt === 0 || now - this.startedAt < CALIBRATION_MS) return null;
    if (this.samples.length < 2) return null;
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    const dt = (last.t - first.t) / 1000;
    if (dt <= 0) return null;
    const rate = (last.bytes - first.bytes) / dt;
    return rate >= 0 ? rate : null;
  }
}
