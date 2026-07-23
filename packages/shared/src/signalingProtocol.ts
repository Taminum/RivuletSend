// Messages exchanged over the WebSocket between client and signaling server.
// This channel only ever carries room bookkeeping + opaque SDP/ICE payloads —
// never file contents, never even filenames.

export type ClientToServerMessage =
  // --- Anonymous, code-based flow (Phase 1) ---
  | { type: "create" }
  | { type: "join"; code: string }
  | { type: "signal"; payload: unknown }
  // --- Authenticated, contact-based flow (Phase 1.5) ---
  // Authenticate this socket and register presence (user is "online").
  | { type: "auth"; token: string }
  // Start a codeless transfer to an online mutual contact.
  | { type: "call"; targetUserId: string }
  // Start a codeless transfer to one of my own paired devices.
  | { type: "call-device"; targetDeviceId: string };

export type CallFailureReason =
  | "unauthenticated"
  | "self"
  | "offline"
  | "not-contact"
  // The target device isn't one of the caller's own online paired devices.
  | "not-your-device";

export type ServerToClientMessage =
  | { type: "created"; code: string }
  | { type: "ready"; initiator: boolean }
  | { type: "signal"; payload: unknown }
  | { type: "peer-left" }
  | { type: "error"; message: string }
  // Presence ack after a successful `auth`.
  | { type: "authed"; userId: string }
  // Initial roster of which of the just-authed user's contacts are online.
  | { type: "presence-snapshot"; online: string[] }
  // A contact came online or went offline while this user is connected.
  | { type: "presence-update"; userId: string; online: boolean }
  // Which of my OWN paired devices are currently online (device ids).
  | { type: "my-devices-snapshot"; online: string[] }
  // One of my own paired devices connected or disconnected.
  | { type: "my-device-update"; deviceId: string; online: boolean }
  // A `call` could not be set up.
  | { type: "call-failed"; reason: CallFailureReason };
