import { WebSocketServer, WebSocket } from "ws";
import jwt from "jsonwebtoken";
import type { ClientToServerMessage, ServerToClientMessage } from "@p2p/shared";
import {
  createRoom,
  joinRoom,
  getPeer,
  touchRoom,
  leaveRoom,
  pairSockets,
  roomCount,
} from "./rooms.js";
import { allowRoomCreate } from "./rateLimiter.js";
import { env } from "./env.js";
import {
  registerPresence,
  unregisterPresence,
  getPresenceUser,
  getSocketDevice,
  isUserOnline,
  getAnyUserSocket,
  getUserSockets,
  getDeviceSocket,
  getDeviceUser,
  onlineDeviceIds,
  setContacts,
  getContacts,
} from "./presence.js";

const wss = new WebSocketServer({ port: env.PORT });

function send(socket: WebSocket, message: ServerToClientMessage): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function getClientIp(socket: WebSocket, req: import("http").IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress ?? "unknown";
}

// Ask the API whether two users have accepted each other, so a call can't be
// placed to a non-contact. Signaling holds no DB of its own.
async function areMutualContacts(userA: string, userB: string): Promise<boolean> {
  try {
    const url = `${env.API_INTERNAL_URL}/internal/contacts/mutual?userA=${encodeURIComponent(
      userA,
    )}&userB=${encodeURIComponent(userB)}`;
    const res = await fetch(url, { headers: { "x-internal-secret": env.INTERNAL_SECRET } });
    if (!res.ok) return false;
    const body = (await res.json()) as { mutual?: boolean };
    return body.mutual === true;
  } catch {
    return false;
  }
}

// The user's mutual-contact ids, so we know whose presence to track/notify.
async function fetchContactIds(userId: string): Promise<string[]> {
  try {
    const url = `${env.API_INTERNAL_URL}/internal/contacts/list?userId=${encodeURIComponent(userId)}`;
    const res = await fetch(url, { headers: { "x-internal-secret": env.INTERNAL_SECRET } });
    if (!res.ok) return [];
    const body = (await res.json()) as { contactIds?: string[] };
    return body.contactIds ?? [];
  } catch {
    return [];
  }
}

// Tell a user's online contacts (each on whatever devices they have open) that
// their presence changed.
function notifyContacts(contactIds: string[], userId: string, online: boolean): void {
  for (const contactId of contactIds) {
    for (const contactSocket of getUserSockets(contactId)) {
      send(contactSocket, { type: "presence-update", userId, online });
    }
  }
}

// Tell a user's OTHER live sessions that one of their own devices changed state.
function notifyOwnSessions(userId: string, exclude: WebSocket, deviceId: string, online: boolean): void {
  for (const s of getUserSockets(userId)) {
    if (s !== exclude) send(s, { type: "my-device-update", deviceId, online });
  }
}

wss.on("connection", (socket, req) => {
  const ip = getClientIp(socket, req);

  socket.on("message", async (raw) => {
    let message: ClientToServerMessage;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      send(socket, { type: "error", message: "Invalid message format" });
      return;
    }

    switch (message.type) {
      // --- Anonymous, code-based flow (unchanged) ---
      case "create": {
        if (!allowRoomCreate(ip)) {
          send(socket, { type: "error", message: "Too many rooms created, try again shortly" });
          return;
        }
        const code = createRoom(socket);
        send(socket, { type: "created", code });
        break;
      }

      case "join": {
        const result = joinRoom(message.code, socket);
        if (!result.ok) {
          send(socket, { type: "error", message: `Cannot join room: ${result.reason}` });
          return;
        }
        const peer = getPeer(socket);
        if (peer) {
          send(peer, { type: "ready", initiator: false });
          send(socket, { type: "ready", initiator: true });
        }
        break;
      }

      case "signal": {
        touchRoom(socket);
        const peer = getPeer(socket);
        if (peer) {
          send(peer, { type: "signal", payload: message.payload });
        }
        break;
      }

      // --- Authenticated, contact-based flow ---
      case "auth": {
        let userId: string;
        let deviceId: string | undefined;
        try {
          const decoded = jwt.verify(message.token, env.JWT_SECRET) as { sub: string; did?: string };
          userId = decoded.sub;
          deviceId = decoded.did;
        } catch {
          send(socket, { type: "error", message: "Invalid token" });
          break;
        }
        const { wasOffline } = registerPresence(userId, socket, deviceId);
        send(socket, { type: "authed", userId });

        // My own paired devices: tell this session which of them are online, and
        // tell my other sessions this device just came online.
        send(socket, {
          type: "my-devices-snapshot",
          online: onlineDeviceIds(userId).filter((d) => d !== deviceId),
        });
        if (deviceId) notifyOwnSessions(userId, socket, deviceId, true);

        // Load this user's contacts, tell them who's already online, and — only
        // when this is the user's first session — let online contacts know.
        const contactIds = await fetchContactIds(userId);
        // The socket may have closed while we were awaiting the API.
        if (getPresenceUser(socket) !== userId) break;
        setContacts(userId, contactIds);
        send(socket, {
          type: "presence-snapshot",
          online: contactIds.filter((id) => isUserOnline(id)),
        });
        if (wasOffline) notifyContacts(contactIds, userId, true);
        break;
      }

      case "call": {
        const callerId = getPresenceUser(socket);
        if (!callerId) {
          send(socket, { type: "call-failed", reason: "unauthenticated" });
          break;
        }
        if (message.targetUserId === callerId) {
          send(socket, { type: "call-failed", reason: "self" });
          break;
        }
        const targetSocket = getAnyUserSocket(message.targetUserId);
        if (!targetSocket) {
          send(socket, { type: "call-failed", reason: "offline" });
          break;
        }
        if (!(await areMutualContacts(callerId, message.targetUserId))) {
          send(socket, { type: "call-failed", reason: "not-contact" });
          break;
        }
        // Pair them and kick off the WebRTC handshake — caller is the initiator.
        pairSockets(socket, targetSocket);
        send(socket, { type: "ready", initiator: true });
        send(targetSocket, { type: "ready", initiator: false });
        break;
      }

      // Self-send: call one of MY OWN online paired devices — no contact check,
      // no code. Only allowed to devices owned by the caller's account.
      case "call-device": {
        const callerId = getPresenceUser(socket);
        if (!callerId) {
          send(socket, { type: "call-failed", reason: "unauthenticated" });
          break;
        }
        const targetSocket = getDeviceSocket(message.targetDeviceId);
        if (!targetSocket || targetSocket === socket) {
          send(socket, { type: "call-failed", reason: "offline" });
          break;
        }
        if (getDeviceUser(message.targetDeviceId) !== callerId) {
          send(socket, { type: "call-failed", reason: "not-your-device" });
          break;
        }
        pairSockets(socket, targetSocket);
        send(socket, { type: "ready", initiator: true });
        send(targetSocket, { type: "ready", initiator: false });
        break;
      }

      default:
        send(socket, { type: "error", message: "Unknown message type" });
    }
  });

  const handleDisconnect = () => {
    const peer = getPeer(socket);
    if (peer) send(peer, { type: "peer-left" });
    leaveRoom(socket);

    // Capture identity + contacts before unregistering clears them.
    const userId = getPresenceUser(socket);
    const deviceId = getSocketDevice(socket);
    const contacts = userId ? getContacts(userId) : [];
    const { nowOffline } = unregisterPresence(socket);

    if (userId) {
      // Contacts only see me go offline once my LAST session closes.
      if (nowOffline) notifyContacts(contacts, userId, false);
      // My other sessions see this device drop — unless it just reconnected
      // (a replacement socket already took over the device id).
      if (deviceId && !getDeviceSocket(deviceId)) {
        notifyOwnSessions(userId, socket, deviceId, false);
      }
    }
  };

  socket.on("close", handleDisconnect);
  socket.on("error", handleDisconnect);
});

console.log(`Signaling server listening on ws://localhost:${env.PORT}`);
console.log(`Active rooms: ${roomCount()}`);
