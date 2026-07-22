import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db";
import { env } from "../env";

// Endpoints for service-to-service calls (the signaling server), not browsers.
// Guarded by a shared secret header rather than a user session.
const mutualQuery = z.object({ userA: z.string(), userB: z.string() });

export async function registerInternalRoutes(app: FastifyInstance): Promise<void> {
  app.get("/internal/contacts/mutual", async (request, reply) => {
    if (request.headers["x-internal-secret"] !== env.INTERNAL_API_SECRET) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const parsed = mutualQuery.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input" });
    const { userA, userB } = parsed.data;

    const [ab, ba] = await Promise.all([
      prisma.contact.findUnique({
        where: { ownerUserId_contactUserId: { ownerUserId: userA, contactUserId: userB } },
      }),
      prisma.contact.findUnique({
        where: { ownerUserId_contactUserId: { ownerUserId: userB, contactUserId: userA } },
      }),
    ]);

    return reply.send({ mutual: Boolean(ab) && Boolean(ba) });
  });

  // Mutual-contact ids for a user, so signaling can drive per-contact presence.
  const listQuery = z.object({ userId: z.string() });
  app.get("/internal/contacts/list", async (request, reply) => {
    if (request.headers["x-internal-secret"] !== env.INTERNAL_API_SECRET) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const parsed = listQuery.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input" });
    const { userId } = parsed.data;

    const [outgoing, incoming] = await Promise.all([
      prisma.contact.findMany({ where: { ownerUserId: userId }, select: { contactUserId: true } }),
      prisma.contact.findMany({ where: { contactUserId: userId }, select: { ownerUserId: true } }),
    ]);
    const incomingSet = new Set(incoming.map((c) => c.ownerUserId));
    const contactIds = outgoing.map((c) => c.contactUserId).filter((id) => incomingSet.has(id));
    return reply.send({ contactIds });
  });
}
