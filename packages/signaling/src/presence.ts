import type { WebSocket } from "ws";

// Tracks which authenticated users currently have the app open, so a contact
// can be reached without exchanging a code. In-memory, single-process — fine
// for an MVP; move to a shared store if signaling is ever scaled out.
const onlineByUser = new Map<string, WebSocket>();
const userBySocket = new Map<WebSocket, string>();
// Mutual-contact ids per online user, so we know whom to notify on connect/close.
const contactsByUser = new Map<string, string[]>();

export function setContacts(userId: string, contactIds: string[]): void {
  contactsByUser.set(userId, contactIds);
}

export function getContacts(userId: string): string[] {
  return contactsByUser.get(userId) ?? [];
}

export function registerPresence(userId: string, socket: WebSocket): void {
  // One live socket per user: replace (and close) an older one.
  const previous = onlineByUser.get(userId);
  if (previous && previous !== socket) {
    try {
      previous.close();
    } catch {
      // ignore
    }
    userBySocket.delete(previous);
  }
  onlineByUser.set(userId, socket);
  userBySocket.set(socket, userId);
}

export function unregisterPresence(socket: WebSocket): void {
  const userId = userBySocket.get(socket);
  if (userId === undefined) return;
  if (onlineByUser.get(userId) === socket) {
    onlineByUser.delete(userId);
    contactsByUser.delete(userId);
  }
  userBySocket.delete(socket);
}

export function getPresenceSocket(userId: string): WebSocket | undefined {
  return onlineByUser.get(userId);
}

export function getPresenceUser(socket: WebSocket): string | undefined {
  return userBySocket.get(socket);
}
