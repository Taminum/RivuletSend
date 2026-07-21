import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import { applyAccent, storedAccent } from "./theme";

// Apply the saved accent before first paint to avoid a flash of the default.
// (Logged-in users' account preference is re-applied once /auth/me resolves.)
applyAccent(storedAccent(), false);

// No StrictMode: the app owns a live WebSocket + RTCPeerConnection created
// imperatively (and, for scan-to-join, during mount). StrictMode's dev-only
// mount→unmount→remount would tear that connection down and reopen a throwaway
// one, which the signaling server treats as a peer joining then leaving —
// disturbing the room. The production build never double-invokes regardless.
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
