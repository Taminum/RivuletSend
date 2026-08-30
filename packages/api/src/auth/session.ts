import type { FastifyReply, FastifyRequest } from "fastify";
import type { User } from "@prisma/client";
import { env } from "../env";
import { prisma } from "../db";

export const AUTH_COOKIE = "token";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days
// Refresh a device's last-seen at most this often, to avoid a write per request.
const LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000;

// The JWT carries the user id (`sub`) and, for paired-device sessions, the
// device id (`did`) so the device can be revoked mid-session.
declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; did?: string };
    user: { sub: string; did?: string };
  }
}

// Returns the freshly signed JWT. The browser ignores it (it relies on the
// httpOnly cookie set here), but non-browser clients — the native mobile app —
// can't read an httpOnly cookie, so they store this token and send it as
// `Authorization: Bearer`. @fastify/jwt reads that header as well as the cookie.
export async function issueSession(
  reply: FastifyReply,
  userId: string,
  deviceId?: string,
): Promise<string> {
  const token = await reply.jwtSign(deviceId ? { sub: userId, did: deviceId } : { sub: userId });
  reply.setCookie(AUTH_COOKIE, token, {
    httpOnly: true, // unreadable by injected scripts
    sameSite: "lax",
    secure: env.COOKIE_SECURE,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return token;
}

export function clearSession(reply: FastifyReply): void {
  reply.clearCookie(AUTH_COOKIE, { path: "/" });
}

// preHandler that rejects unauthenticated requests. On success, request.user.sub
// holds the user id.
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    return reply.code(401).send({ error: "unauthorized" });
  }
  // Paired-device session: reject on every request if the device was revoked,
  // so "Remove device" takes effect immediately (not at next login). Refresh
  // last-seen occasionally so the devices list stays meaningful.
  const did = request.user.did;
  if (did) {
    const device = await prisma.device.findUnique({ where: { id: did } });
    if (!device || device.revokedAt) {
      clearSession(reply);
      return reply.code(401).send({ error: "device_revoked" });
    }
    if (Date.now() - device.lastSeenAt.getTime() > LAST_SEEN_THROTTLE_MS) {
      await prisma.device.update({ where: { id: did }, data: { lastSeenAt: new Date() } });
    }
  }
}

// Shape returned to clients — never includes passwordHash. The telegram_id
// column is deprecated (Telegram sign-in was removed) and intentionally left
// out of the response; the column still exists but is no longer surfaced.
export function serializeUser(user: User) {
  return {
    id: user.id,
    displayName: user.displayName,
    email: user.email,
    accentPreference: user.accentPreference,
    createdAt: user.createdAt.toISOString(),
  };
}
