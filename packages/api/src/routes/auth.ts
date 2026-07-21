import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { env } from "../env";
import { parseBody } from "../http";
import { hashPassword, verifyPassword } from "../auth/password";
import { verifyTelegramAuth, type TelegramAuthData } from "../auth/telegram";
import {
  issueSession,
  clearSession,
  requireAuth,
  serializeUser,
} from "../auth/session";

const signupSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  email: z.string().trim().email(),
  password: z.string().min(8).max(200),
});

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(200),
});

const telegramSchema = z.object({
  id: z.number(),
  first_name: z.string(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  photo_url: z.string().optional(),
  auth_date: z.number(),
  hash: z.string(),
});

const linkPasswordSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8).max(200),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(200),
});

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  // --- Email + password signup ---
  app.post("/auth/signup", async (request, reply) => {
    const body = parseBody(signupSchema, request, reply);
    if (!body) return;

    const passwordHash = await hashPassword(body.password);
    try {
      const user = await prisma.user.create({
        data: { displayName: body.displayName, email: body.email, passwordHash },
      });
      await issueSession(reply, user.id);
      return reply.code(201).send({ user: serializeUser(user) });
    } catch (err) {
      if (isUniqueViolation(err)) {
        return reply.code(409).send({ error: "email_taken" });
      }
      throw err;
    }
  });

  // --- Email + password login ---
  app.post("/auth/login", async (request, reply) => {
    const body = parseBody(loginSchema, request, reply);
    if (!body) return;

    const user = await prisma.user.findUnique({ where: { email: body.email } });
    // Same response whether the email is unknown or the password is wrong, so
    // the endpoint doesn't reveal which emails have accounts.
    if (!user || !user.passwordHash || !(await verifyPassword(body.password, user.passwordHash))) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }
    await issueSession(reply, user.id);
    return reply.send({ user: serializeUser(user) });
  });

  // --- Telegram Login Widget ---
  app.post("/auth/telegram", async (request, reply) => {
    const body = parseBody(telegramSchema, request, reply);
    if (!body) return;
    if (!env.TELEGRAM_BOT_TOKEN) {
      return reply.code(501).send({ error: "telegram_not_configured" });
    }
    if (!verifyTelegramAuth(body as TelegramAuthData, env.TELEGRAM_BOT_TOKEN)) {
      return reply.code(401).send({ error: "invalid_telegram_signature" });
    }

    const telegramId = BigInt(body.id);
    const displayName = [body.first_name, body.last_name].filter(Boolean).join(" ") || body.username || "Telegram user";
    const user = await prisma.user.upsert({
      where: { telegramId },
      create: { telegramId, displayName },
      update: {},
    });
    await issueSession(reply, user.id);
    return reply.send({ user: serializeUser(user) });
  });

  // --- Current user ---
  app.get("/auth/me", { preHandler: requireAuth }, async (request, reply) => {
    const user = await prisma.user.findUnique({ where: { id: request.user.sub } });
    if (!user) {
      clearSession(reply);
      return reply.code(401).send({ error: "unauthorized" });
    }
    return reply.send({ user: serializeUser(user) });
  });

  // --- Logout ---
  app.post("/auth/logout", async (_request, reply) => {
    clearSession(reply);
    return reply.send({ ok: true });
  });

  // --- Change password ---
  app.post("/auth/password", { preHandler: requireAuth }, async (request, reply) => {
    const body = parseBody(changePasswordSchema, request, reply);
    if (!body) return;
    const user = await prisma.user.findUnique({ where: { id: request.user.sub } });
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!user.passwordHash) return reply.code(400).send({ error: "no_password_set" });
    if (!(await verifyPassword(body.currentPassword, user.passwordHash))) {
      return reply.code(400).send({ error: "wrong_password" });
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(body.newPassword) },
    });
    return reply.send({ ok: true });
  });

  // --- Unlink Telegram (only if another login method remains) ---
  app.post("/auth/unlink/telegram", { preHandler: requireAuth }, async (request, reply) => {
    const user = await prisma.user.findUnique({ where: { id: request.user.sub } });
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!user.telegramId) return reply.code(400).send({ error: "telegram_not_linked" });
    if (!user.passwordHash) return reply.code(400).send({ error: "cannot_unlink_only_method" });
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { telegramId: null },
    });
    return reply.send({ user: serializeUser(updated) });
  });

  // --- Accent preference (UI theme), follows the user across devices ---
  app.post("/auth/accent", { preHandler: requireAuth }, async (request, reply) => {
    const body = parseBody(
      z.object({ accent: z.enum(["green", "cobalt", "amber", "violet"]) }),
      request,
      reply,
    );
    if (!body) return;
    const user = await prisma.user.update({
      where: { id: request.user.sub },
      data: { accentPreference: body.accent },
    });
    return reply.send({ user: serializeUser(user) });
  });

  // --- Short-lived token for authenticating the signaling WebSocket ---
  // The session lives in an httpOnly cookie (unreadable by JS) and signaling is
  // a different origin, so the client fetches this readable, short-lived token
  // and presents it in the WS `auth` message.
  app.get("/auth/ws-token", { preHandler: requireAuth }, async (request, reply) => {
    const token = await reply.jwtSign({ sub: request.user.sub }, { expiresIn: "2m" });
    return reply.send({ token });
  });

  // --- Link email+password to an existing (e.g. Telegram-created) account ---
  app.post("/auth/link/password", { preHandler: requireAuth }, async (request, reply) => {
    const body = parseBody(linkPasswordSchema, request, reply);
    if (!body) return;

    const user = await prisma.user.findUnique({ where: { id: request.user.sub } });
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (user.passwordHash) return reply.code(409).send({ error: "password_already_set" });

    const passwordHash = await hashPassword(body.password);
    try {
      const updated = await prisma.user.update({
        where: { id: user.id },
        data: { email: body.email, passwordHash },
      });
      return reply.send({ user: serializeUser(updated) });
    } catch (err) {
      if (isUniqueViolation(err)) return reply.code(409).send({ error: "email_taken" });
      throw err;
    }
  });

  // --- Link Telegram to an existing (e.g. email-created) account ---
  app.post("/auth/link/telegram", { preHandler: requireAuth }, async (request, reply) => {
    const body = parseBody(telegramSchema, request, reply);
    if (!body) return;
    if (!env.TELEGRAM_BOT_TOKEN) {
      return reply.code(501).send({ error: "telegram_not_configured" });
    }
    if (!verifyTelegramAuth(body as TelegramAuthData, env.TELEGRAM_BOT_TOKEN)) {
      return reply.code(401).send({ error: "invalid_telegram_signature" });
    }

    const user = await prisma.user.findUnique({ where: { id: request.user.sub } });
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (user.telegramId) return reply.code(409).send({ error: "telegram_already_linked" });

    try {
      const updated = await prisma.user.update({
        where: { id: user.id },
        data: { telegramId: BigInt(body.id) },
      });
      return reply.send({ user: serializeUser(updated) });
    } catch (err) {
      if (isUniqueViolation(err)) return reply.code(409).send({ error: "telegram_in_use" });
      throw err;
    }
  });
}
