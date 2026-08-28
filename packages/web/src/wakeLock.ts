import { useEffect } from "react";

// Keep the screen awake during a transfer (mobile screens sleeping can drop the
// connection). Ref-counted so the room and contact flows can both hold it, and
// re-acquired when the tab becomes visible again (the OS releases the lock on
// hide). No-op where the Wake Lock API is unsupported.

interface WakeSentinel {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (t: string, cb: () => void) => void;
}

let sentinel: WakeSentinel | null = null;
let count = 0;

async function ensure(): Promise<void> {
  if (sentinel || count === 0 || document.visibilityState !== "visible") return;
  try {
    const wl = (navigator as unknown as { wakeLock?: { request?: (t: string) => Promise<WakeSentinel> } }).wakeLock;
    sentinel = (await wl?.request?.("screen")) ?? null;
    sentinel?.addEventListener("release", () => {
      sentinel = null;
    });
  } catch {
    /* denied / unsupported */
  }
}

function acquire(): void {
  count += 1;
  void ensure();
}

function release(): void {
  count = Math.max(0, count - 1);
  if (count === 0 && sentinel) {
    void sentinel.release().catch(() => {});
    sentinel = null;
  }
}

// The OS drops the lock when the tab hides; re-take it on return if still needed.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void ensure();
  });
}

export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    acquire();
    return () => release();
  }, [active]);
}
