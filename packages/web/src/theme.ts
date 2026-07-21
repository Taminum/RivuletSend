// Accent presets. Only --rs-accent / --rs-accent-dim are overridden at runtime;
// nothing else in the codebase hardcodes the accent color. Presets are curated
// so every option keeps decent contrast against --rs-bg.
export const ACCENTS = {
  green: { accent: "#2ee6a8", dim: "#163d30", label: "Signal green" },
  cobalt: { accent: "#4fa3ff", dim: "#152a42", label: "Cold cobalt" },
  amber: { accent: "#ffb020", dim: "#3a2b0c", label: "Hazard amber" },
  violet: { accent: "#9b7bff", dim: "#26203f", label: "Violet" },
} as const;

export type AccentKey = keyof typeof ACCENTS;
export const ACCENT_KEYS = Object.keys(ACCENTS) as AccentKey[];

const STORAGE_KEY = "rs-accent";

export function isAccentKey(k: string | null | undefined): k is AccentKey {
  return typeof k === "string" && k in ACCENTS;
}

export function applyAccent(key: AccentKey, persist = true): void {
  const a = ACCENTS[key] ?? ACCENTS.green;
  const root = document.documentElement;
  root.style.setProperty("--rs-accent", a.accent);
  root.style.setProperty("--rs-accent-dim", a.dim);
  if (persist) localStorage.setItem(STORAGE_KEY, key);
}

export function storedAccent(): AccentKey {
  const k = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
  return isAccentKey(k) ? k : "green";
}
