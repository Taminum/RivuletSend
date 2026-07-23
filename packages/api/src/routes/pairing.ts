import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, issueSession, serializeUser } from "../auth/session";

// Pairing lets a fresh device join an account without typing a password: it
// shows a short code/QR, an already-signed-in device approves it, and the fresh
// device (which is polling) receives a session. Codes are short-lived and
// single-use.
// 2 minutes by default; overridable (shorter for tests, tunable for a deploy).
const CODE_TTL_MS = Number(process.env.PAIRING_TTL_MS) || 2 * 60 * 1000;
const PLATFORMS = ["windows", "macos", "linux", "web", "android", "ios"] as const;

function sixDigits(): string {
  return String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
}

// A pending request past its expiry is treated as expired (and marked so).
function isLive(req: { status: string; expiresAt: Date; claimedAt: Date | null }): boolean {
  return req.status === "pending" && req.expiresAt.getTime() > Date.now() && !req.claimedAt;
}

export async function registerPairingRoutes(app: FastifyInstance): Promise<void> {
  const requestSchema = z.object({
    platform: z.enum(PLATFORMS).optional(),
    label: z.string().trim().min(1).max(60).optional(),
  });

  // 1. Fresh device asks for a code. No auth — it doesn't know whose account yet.
  app.post("/pairing/request", async (request, reply) => {
    const parsed = requestSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input" });

    const expiresAt = new Date(Date.now() + CODE_TTL_MS);
    // Retry on the rare unique-code collision.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const req = await prisma.pairingRequest.create({
          data: {
            code: sixDigits(),
            requestedPlatform: parsed.data.platform,
            requestedLabel: parsed.data.label,
            expiresAt,
          },
        });
        return reply.send({ code: req.code, expiresAt: req.expiresAt.toISOString() });
      } catch {
        /* collision — try another code */
      }
    }
    return reply.code(500).send({ error: "could_not_allocate_code" });
  });

  // 2a. Approving device looks up who it's about to approve (platform + when),
  // so a user can't be tricked into approving a request they didn't initiate.
  app.get<{ Params: { code: string } }>(
    "/pairing/:code/info",
    { preHandler: requireAuth },
    async (request, reply) => {
      const req = await prisma.pairingRequest.findUnique({ where: { code: request.params.code } });
      if (!req || !isLive(req)) return reply.code(404).send({ error: "not_found_or_expired" });
      return reply.send({
        requestedPlatform: req.requestedPlatform,
        createdAt: req.createdAt.toISOString(),
        expiresAt: req.expiresAt.toISOString(),
      });
    },
  );

  // 2b. Approving device approves the code: create the Device row and mark the
  // request approved. The requester (polling) will claim its session next.
  const approveSchema = z.object({
    code: z.string().regex(/^\d{6}$/),
    label: z.string().trim().min(1).max(60).optional(),
  });
  app.post("/pairing/approve", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = approveSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input" });

    const req = await prisma.pairingRequest.findUnique({ where: { code: parsed.data.code } });
    if (!req || !isLive(req)) return reply.code(404).send({ error: "not_found_or_expired" });

    const device = await prisma.device.create({
      data: {
        userId: request.user.sub,
        label: parsed.data.label ?? req.requestedLabel ?? "New device",
        platform: req.requestedPlatform,
      },
    });
    await prisma.pairingRequest.update({
      where: { id: req.id },
      data: { status: "approved", approvedDeviceId: device.id },
    });
    return reply.send({ ok: true, device: { id: device.id, label: device.label } });
  });

  // 3. Fresh device polls. Once approved it claims a session exactly once; the
  // code can't be reused after that (guards against a captured code).
  app.get<{ Params: { code: string } }>("/pairing/:code/status", async (request, reply) => {
    const req = await prisma.pairingRequest.findUnique({ where: { code: request.params.code } });
    if (!req) return reply.send({ status: "expired" });

    if (req.status === "pending") {
      if (req.expiresAt.getTime() <= Date.now()) {
        await prisma.pairingRequest.update({ where: { id: req.id }, data: { status: "expired" } });
        return reply.send({ status: "expired" });
      }
      return reply.send({ status: "pending" });
    }

    if (req.status === "approved" && !req.claimedAt && req.approvedDeviceId) {
      const device = await prisma.device.findUnique({ where: { id: req.approvedDeviceId } });
      if (!device || device.revokedAt) return reply.send({ status: "expired" });
      const user = await prisma.user.findUnique({ where: { id: device.userId } });
      if (!user) return reply.send({ status: "expired" });
      // Single-use: mark claimed so a re-poll (or a captured code) can't re-issue.
      await prisma.pairingRequest.update({ where: { id: req.id }, data: { claimedAt: new Date() } });
      await issueSession(reply, user.id, device.id);
      return reply.send({ status: "approved", user: serializeUser(user) });
    }

    // approved + already claimed, or expired.
    return reply.send({ status: "expired" });
  });
}
