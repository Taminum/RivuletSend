// Optional completion chime + desktop notification. Off by default.
//
// Two browser constraints shape this:
//  - Notification permission is requested ONLY when the user turns the toggle
//    on, in direct response to that click — never on load — since a request
//    without a gesture gets auto-denied and burns the one clean chance to ask.
//  - Audio autoplay is blocked without a recent user gesture. A chime for a
//    transfer that finished while the user was elsewhere may simply not play;
//    that's accepted (the desktop notification still carries the message) — no
//    silent-primer hacks.

const KEY = "rs-notify";

export function soundsEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

// Turn the feature on/off. Turning ON also requests notification permission,
// but only while permission is still "default" — a prior denial is respected
// and not re-prompted.
export async function setSoundsEnabled(on: boolean): Promise<void> {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* storage disabled */
  }
  if (on && typeof Notification !== "undefined" && Notification.permission === "default") {
    try {
      await Notification.requestPermission();
    } catch {
      /* ignore */
    }
  }
}

// Fire a desktop notification (only if granted) + a best-effort chime for a
// completed transfer. Silent no-op when disabled or permission was denied.
export function notifyTransferComplete(fileName: string, size: string): void {
  if (!soundsEnabled()) return;
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    try {
      new Notification("Transfer complete", { body: `${fileName} · ${size}` });
    } catch {
      /* some browsers throw for non-persistent notifications */
    }
  }
  playChime();
}

// A short two-note chime, synthesized (no bundled audio asset). Best effort:
// if the AudioContext is suspended by the autoplay policy, nothing plays.
function playChime(): void {
  try {
    const Ctx =
      window.AudioContext ||
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx: AudioContext = new Ctx();
    const now = ctx.currentTime;
    [880, 1174.66].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t = now + i * 0.12;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.15, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.26);
    });
    setTimeout(() => void ctx.close().catch(() => {}), 700);
  } catch {
    /* best effort */
  }
}
