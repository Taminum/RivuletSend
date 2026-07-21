import type { FastifyReply, FastifyRequest } from "fastify";
import type { User } from "@prisma/client";
import { env } from "../env";

export const AUTH_COOKIE = "token";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

// The JWT carries only the user id (`sub`); everything else is loaded fresh.
declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string };
    user: { sub: string };
  }
}

export async function issueSession(reply: FastifyReply, userId: string): Promise<void> {
  const token = await reply.jwtSign({ sub: userId });
  reply.setCookie(AUTH_COOKIE, token, {
    httpOnly: true, // unreadable by injected scripts
    sameSite: "lax",
    secure: env.COOKIE_SECURE,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
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
    reply.code(401).send({ error: "unauthorized" });
  }
}

// Shape returned to clients — never includes passwordHash, and BigInt telegramId
// is stringified (BigInt isn't JSON-serializable).
export function serializeUser(user: User) {
  return {
    id: user.id,
    displayName: user.displayName,
    email: user.email,
    telegramId: user.telegramId?.toString() ?? null,
    accentPreference: user.accentPreference,
    createdAt: user.createdAt.toISOString(),
  };
}
