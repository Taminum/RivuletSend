import type { WebSocket } from "ws";
import { generateRoomCode, isValidRoomCode } from "@p2p/shared";

const IDLE_TIMEOUT_MS = 10 * 60_000;

interface Room {
  code: string;
  peers: WebSocket[];
  idleTimer: ReturnType<typeof setTimeout>;
  // Burn-after-read: once one full transfer completes on this room, the code is
  // invalidated for any further joins. Layered on top of the idle TTL, not a
  // separate timer.
  burnAfterRead?: boolean;
  completedAt?: number;
}

const rooms = new Map<string, Room>();
const socketToRoom = new Map<WebSocket, string>();

function scheduleIdleCleanup(room: Room): void {
  clearTimeout(room.idleTimer);
  room.idleTimer = setTimeout(() => destroyRoom(room.code), IDLE_TIMEOUT_MS);
  room.idleTimer.unref?.();
}

export function createRoom(creator: WebSocket, burnAfterRead = false): string {
  let code = generateRoomCode();
  while (rooms.has(code)) code = generateRoomCode();

  const room: Room = { code, peers: [creator], idleTimer: setTimeout(() => {}, 0), burnAfterRead };
  scheduleIdleCleanup(room);
  rooms.set(code, room);
  socketToRoom.set(creator, code);
  return code;
}

export type JoinResult =
  | { ok: true }
  | { ok: false; reason: "not-found" | "full" | "invalid-code" | "used" };

export function joinRoom(code: string, joiner: WebSocket): JoinResult {
  const normalized = code.toUpperCase();
  if (!isValidRoomCode(normalized)) return { ok: false, reason: "invalid-code" };

  const room = rooms.get(normalized);
  if (!room) return { ok: false, reason: "not-found" };
  // Burn-after-read: a completed one-shot link can't be reused.
  if (room.burnAfterRead && room.completedAt) return { ok: false, reason: "used" };
  if (room.peers.length >= 2) return { ok: false, reason: "full" };

  room.peers.push(joiner);
  socketToRoom.set(joiner, normalized);
  scheduleIdleCleanup(room);
  return { ok: true };
}

// The receiver reported a full transfer finished. On a burn-after-read room this
// stamps completedAt, which joinRoom then treats as an invalidated code.
export function markTransferComplete(socket: WebSocket): void {
  const code = socketToRoom.get(socket);
  if (!code) return;
  const room = rooms.get(code);
  if (room?.burnAfterRead && !room.completedAt) room.completedAt = Date.now();
}

// Directly pair two already-connected sockets into a room (used by the
// contact-call flow, where presence replaces the code exchange). Removes each
// socket from any prior room first so no room is orphaned.
export function pairSockets(a: WebSocket, b: WebSocket): void {
  removeFromRoom(a);
  removeFromRoom(b);

  let code = generateRoomCode();
  while (rooms.has(code)) code = generateRoomCode();

  const room: Room = { code, peers: [a, b], idleTimer: setTimeout(() => {}, 0) };
  scheduleIdleCleanup(room);
  rooms.set(code, room);
  socketToRoom.set(a, code);
  socketToRoom.set(b, code);
}

function removeFromRoom(socket: WebSocket): void {
  const code = socketToRoom.get(socket);
  if (!code) return;
  socketToRoom.delete(socket);
  const room = rooms.get(code);
  if (!room) return;
  room.peers = room.peers.filter((p) => p !== socket);
  if (room.peers.length === 0) {
    clearTimeout(room.idleTimer);
    rooms.delete(code);
  }
}

export function getPeer(socket: WebSocket): WebSocket | undefined {
  const code = socketToRoom.get(socket);
  if (!code) return undefined;
  const room = rooms.get(code);
  return room?.peers.find((p) => p !== socket);
}

export function touchRoom(socket: WebSocket): void {
  const code = socketToRoom.get(socket);
  if (!code) return;
  const room = rooms.get(code);
  if (room) scheduleIdleCleanup(room);
}

export function leaveRoom(socket: WebSocket): void {
  const code = socketToRoom.get(socket);
  if (!code) return;
  socketToRoom.delete(socket);
  destroyRoom(code);
}

function destroyRoom(code: string): void {
  const room = rooms.get(code);
  if (!room) return;
  clearTimeout(room.idleTimer);
  rooms.delete(code);
  for (const peer of room.peers) {
    socketToRoom.delete(peer);
  }
}

export function roomCount(): number {
  return rooms.size;
}
