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
  getPresenceSocket,
  getPresenceUser,
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

// Tell a user's currently-online contacts that their presence changed.
function notifyContacts(userId: string, online: boolean): void {
  for (const contactId of getContacts(userId)) {
    const contactSocket = getPresenceSocket(contactId);
    if (contactSocket) send(contactSocket, { type: "presence-update", userId, online });
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
        try {
          const decoded = jwt.verify(message.token, env.JWT_SECRET) as { sub: string };
          userId = decoded.sub;
        } catch {
          send(socket, { type: "error", message: "Invalid token" });
          break;
        }
        registerPresence(userId, socket);
        send(socket, { type: "authed", userId });

        // Load this user's contacts, tell them who's already online, and let any
        // online contacts know this user just came online.
        const contactIds = await fetchContactIds(userId);
        // The socket may have closed while we were awaiting the API.
        if (getPresenceSocket(userId) !== socket) break;
        setContacts(userId, contactIds);
        const onlineContacts = contactIds.filter((id) => getPresenceSocket(id));
        send(socket, { type: "presence-snapshot", online: onlineContacts });
        notifyContacts(userId, true);
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
        const targetSocket = getPresenceSocket(message.targetUserId);
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

      default:
        send(socket, { type: "error", message: "Unknown message type" });
    }
  });

  const handleDisconnect = () => {
    const peer = getPeer(socket);
    if (peer) send(peer, { type: "peer-left" });
    leaveRoom(socket);
    // Only announce offline if this socket is still the user's live one (a
    // replaced socket was already superseded and must not clear the new state).
    const userId = getPresenceUser(socket);
    if (userId && getPresenceSocket(userId) === socket) notifyContacts(userId, false);
    unregisterPresence(socket);
  };

  socket.on("close", handleDisconnect);
  socket.on("error", handleDisconnect);
});

console.log(`Signaling server listening on ws://localhost:${env.PORT}`);
console.log(`Active rooms: ${roomCount()}`);
