import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import { applyAccent, storedAccent } from "./theme";
import { applyCompact, storedCompact } from "./display";
import { cleanupOrphanedOpfsFiles } from "./opfs/opfsCleanup";

// Apply the saved accent before first paint to avoid a flash of the default.
// (Logged-in users' account preference is re-applied once /auth/me resolves.)
applyAccent(storedAccent(), false);
// Apply the saved list density before first paint too.
applyCompact(storedCompact(), false);

// Sweep OPFS temp files left over from a tab that crashed mid-transfer. Runs
// once at startup, before any new receive, so nothing currently live is touched.
void cleanupOrphanedOpfsFiles();

// No StrictMode: the app owns a live WebSocket + RTCPeerConnection created
// imperatively (and, for scan-to-join, during mount). StrictMode's dev-only
// mount→unmount→remount would tear that connection down and reopen a throwaway
// one, which the signaling server treats as a peer joining then leaving —
// disturbing the room. The production build never double-invokes regardless.
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);

// Register the service worker so the app is installable (own icon, no browser
// chrome) and has an offline shell. Not in the desktop shell (it loads a remote
// URL and has native chrome already). Failures are non-fatal.
if ("serviceWorker" in navigator && !window.rivulet?.isDesktop) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
