import { useEffect } from "react";

// Show live transfer progress in the tab title ("↑ 42% · OwlSend") so a
// backgrounded tab still shows how far along a transfer is. Multiple sources
// (room + contact flows) register under their own id; the title reflects the
// least-done active one.

const BASE = "OwlSend";
const sources = new Map<string, { pct: number; dir: "up" | "down" }>();

function render(): void {
  if (typeof document === "undefined") return;
  const active = [...sources.values()];
  if (active.length === 0) {
    document.title = BASE;
    return;
  }
  const least = active.reduce((a, b) => (b.pct < a.pct ? b : a));
  document.title = `${least.dir === "down" ? "↓" : "↑"} ${Math.round(least.pct)}% · ${BASE}`;
}

// Drives the tab title from a source's progress; clears it on unmount / inactive.
export function useTransferTitle(id: string, active: boolean, pct: number, dir: "up" | "down"): void {
  useEffect(() => {
    if (!active) {
      sources.delete(id);
      render();
      return;
    }
    sources.set(id, { pct: Math.max(0, Math.min(100, pct)), dir });
    render();
    return () => {
      sources.delete(id);
      render();
    };
  }, [id, active, pct, dir]);
}
