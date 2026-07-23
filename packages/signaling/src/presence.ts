import type { WebSocket } from "ws";

// Tracks which authenticated users (and which of their paired devices) currently
// have the app open. A user may now have SEVERAL live sockets at once (phone +
// desktop), so a paired device can receive a self-send from another of the
// user's devices. In-memory, single-process — fine for an MVP.
interface SocketMeta {
  userId: string;
  deviceId?: string;
}

const socketsByUser = new Map<string, Set<WebSocket>>();
const metaBySocket = new Map<WebSocket, SocketMeta>();
// One socket per device id (a device reconnecting replaces its old socket).
const socketByDevice = new Map<string, WebSocket>();
// Mutual-contact ids per online user, so we know whom to notify on connect/close.
const contactsByUser = new Map<string, string[]>();

export function setContacts(userId: string, contactIds: string[]): void {
  contactsByUser.set(userId, contactIds);
}
export function getContacts(userId: string): string[] {
  return contactsByUser.get(userId) ?? [];
}

// Returns whether the user was fully offline before this socket (i.e. this is
// their first live session), so the caller can decide when to notify contacts.
export function registerPresence(
  userId: string,
  socket: WebSocket,
  deviceId?: string,
): { wasOffline: boolean } {
  const existing = socketsByUser.get(userId);
  const wasOffline = !existing || existing.size === 0;

  const set = existing ?? new Set<WebSocket>();
  set.add(socket);
  socketsByUser.set(userId, set);
  metaBySocket.set(socket, { userId, deviceId });

  if (deviceId) {
    const prev = socketByDevice.get(deviceId);
    if (prev && prev !== socket) {
      try {
        prev.close();
      } catch {
        /* ignore */
      }
    }
    socketByDevice.set(deviceId, socket);
  }
  return { wasOffline };
}

// Returns the removed socket's user/device and whether the user is now fully
// offline (their last session closed).
export function unregisterPresence(socket: WebSocket): {
  userId?: string;
  deviceId?: string;
  nowOffline: boolean;
} {
  const meta = metaBySocket.get(socket);
  if (!meta) return { nowOffline: false };
  metaBySocket.delete(socket);

  const set = socketsByUser.get(meta.userId);
  set?.delete(socket);
  const nowOffline = !set || set.size === 0;
  if (nowOffline) {
    socketsByUser.delete(meta.userId);
    contactsByUser.delete(meta.userId);
  }
  if (meta.deviceId && socketByDevice.get(meta.deviceId) === socket) {
    socketByDevice.delete(meta.deviceId);
  }
  return { userId: meta.userId, deviceId: meta.deviceId, nowOffline };
}

export function isUserOnline(userId: string): boolean {
  return (socketsByUser.get(userId)?.size ?? 0) > 0;
}

// Any one of a user's sockets — used for a contact call (reach the contact on
// whichever device they have open).
export function getAnyUserSocket(userId: string): WebSocket | undefined {
  const set = socketsByUser.get(userId);
  return set && set.size > 0 ? set.values().next().value : undefined;
}

export function getUserSockets(userId: string): WebSocket[] {
  return [...(socketsByUser.get(userId) ?? [])];
}

export function getDeviceSocket(deviceId: string): WebSocket | undefined {
  return socketByDevice.get(deviceId);
}

// The user id that owns a device's live socket (for self-send authorization).
export function getDeviceUser(deviceId: string): string | undefined {
  const socket = socketByDevice.get(deviceId);
  return socket ? metaBySocket.get(socket)?.userId : undefined;
}

// Online device ids for a user (paired sessions only carry a device id).
export function onlineDeviceIds(userId: string): string[] {
  return getUserSockets(userId)
    .map((s) => metaBySocket.get(s)?.deviceId)
    .filter((d): d is string => Boolean(d));
}

export function getPresenceUser(socket: WebSocket): string | undefined {
  return metaBySocket.get(socket)?.userId;
}

export function getSocketDevice(socket: WebSocket): string | undefined {
  return metaBySocket.get(socket)?.deviceId;
}
