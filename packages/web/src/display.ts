// "Compact lists" display density. Persisted locally and applied as a single
// class on the document root, so one toggle tightens every list (Contacts,
// History, folder tree) at once — no per-component density wiring that could
// drift out of sync.
const KEY = "rs-compact";

export function storedCompact(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function applyCompact(on: boolean, persist = true): void {
  document.documentElement.classList.toggle("compact", on);
  if (persist) {
    try {
      localStorage.setItem(KEY, on ? "1" : "0");
    } catch {
      /* private mode / storage disabled */
    }
  }
}
