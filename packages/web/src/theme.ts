// Accent presets. At runtime only --rs-accent / --rs-accent-soft / --rs-accent-dim
// are overridden; nothing else hardcodes the accent color. Each preset is tuned to
// read well against --rs-bg (#121214) in the rounded, friendlier style:
//   accent — the main fill (buttons, active states, links)
//   soft   — a lighter tint used for the transfer code text
//   dim    — a dark, low-chroma surface behind accent content (code card, hovers)
export const ACCENTS = {
  iris: { accent: "#7c6df2", soft: "#a599f7", dim: "#201d33", label: "Iris" },
  sky: { accent: "#4aa8ff", soft: "#8ec7ff", dim: "#152634", label: "Sky" },
  mint: { accent: "#3ed598", soft: "#88e6c1", dim: "#123028", label: "Mint" },
  amber: { accent: "#ffb454", soft: "#ffcf94", dim: "#33260f", label: "Amber" },
  rose: { accent: "#f26db0", soft: "#f7a3cd", dim: "#331826", label: "Rose" },
} as const;

export type AccentKey = keyof typeof ACCENTS;
export const ACCENT_KEYS = Object.keys(ACCENTS) as AccentKey[];

const STORAGE_KEY = "rs-accent";

export function isAccentKey(k: string | null | undefined): k is AccentKey {
  return typeof k === "string" && k in ACCENTS;
}

export function applyAccent(key: AccentKey, persist = true): void {
  const a = ACCENTS[key] ?? ACCENTS.iris;
  const root = document.documentElement;
  root.style.setProperty("--rs-accent", a.accent);
  root.style.setProperty("--rs-accent-soft", a.soft);
  root.style.setProperty("--rs-accent-dim", a.dim);
  if (persist) localStorage.setItem(STORAGE_KEY, key);
}

export function storedAccent(): AccentKey {
  const k = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
  return isAccentKey(k) ? k : "iris";
}
