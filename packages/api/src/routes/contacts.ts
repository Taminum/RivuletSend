import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db";
import { parseBody } from "../http";
import { requireAuth, serializeUser } from "../auth/session";

// Contacts are directed edges (owner -> contact). A relationship is only
// "accepted" when both edges exist, so nobody lands in your contacts — or
// becomes a valid send target — without your own matching edge.
type ContactStatus = "accepted" | "outgoing" | "incoming";

const addSchema = z
  .object({
    userId: z.string().optional(),
    email: z.string().trim().email().optional(),
  })
  .refine((v) => v.userId || v.email, { message: "userId or email required" });

export async function registerContactRoutes(app: FastifyInstance): Promise<void> {
  // Add (or accept) a contact. Idempotent: creating an edge that already exists
  // is a no-op. If the reverse edge exists, this makes the relationship mutual.
  app.post("/contacts", { preHandler: requireAuth }, async (request, reply) => {
    const body = parseBody(addSchema, request, reply);
    if (!body) return;
    const me = request.user.sub;

    const target = body.userId
      ? await prisma.user.findUnique({ where: { id: body.userId } })
      : await prisma.user.findUnique({ where: { email: body.email! } });

    if (!target) return reply.code(404).send({ error: "user_not_found" });
    if (target.id === me) return reply.code(400).send({ error: "cannot_add_self" });

    await prisma.contact.upsert({
      where: { ownerUserId_contactUserId: { ownerUserId: me, contactUserId: target.id } },
      create: { ownerUserId: me, contactUserId: target.id },
      update: {},
    });

    const reverse = await prisma.contact.findUnique({
      where: { ownerUserId_contactUserId: { ownerUserId: target.id, contactUserId: me } },
    });
    const status: ContactStatus = reverse ? "accepted" : "outgoing";
    return reply.code(201).send({ contact: { user: serializeUser(target), status } });
  });

  // List contacts, grouped by relationship state.
  app.get("/contacts", { preHandler: requireAuth }, async (request, reply) => {
    const me = request.user.sub;

    const [outgoing, incoming] = await Promise.all([
      prisma.contact.findMany({ where: { ownerUserId: me }, include: { contact: true } }),
      prisma.contact.findMany({ where: { contactUserId: me }, include: { owner: true } }),
    ]);

    const incomingIds = new Set(incoming.map((c) => c.ownerUserId));
    const outgoingIds = new Set(outgoing.map((c) => c.contactUserId));

    // `alias` is my private nickname for them (null unless I set one).
    const accepted = outgoing
      .filter((c) => incomingIds.has(c.contactUserId))
      .map((c) => ({ user: serializeUser(c.contact), status: "accepted" as const, alias: c.alias }));

    const pendingOutgoing = outgoing
      .filter((c) => !incomingIds.has(c.contactUserId))
      .map((c) => ({ user: serializeUser(c.contact), status: "outgoing" as const, alias: c.alias }));

    const pendingIncoming = incoming
      .filter((c) => !outgoingIds.has(c.ownerUserId))
      .map((c) => ({ user: serializeUser(c.owner), status: "incoming" as const, alias: null }));

    return reply.send({
      accepted,
      outgoing: pendingOutgoing,
      incoming: pendingIncoming,
    });
  });

  // Rename a contact — a private nickname stored on my edge only, so the other
  // person never sees it. Sending an empty alias clears it.
  app.patch("/contacts/:userId", { preHandler: requireAuth }, async (request, reply) => {
    const me = request.user.sub;
    const { userId } = request.params as { userId: string };
    const parsed = z
      .object({ alias: z.string().trim().max(60).nullable() })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input" });

    const alias = parsed.data.alias ? parsed.data.alias : null;
    const updated = await prisma.contact.updateMany({
      where: { ownerUserId: me, contactUserId: userId },
      data: { alias },
    });
    if (updated.count === 0) return reply.code(404).send({ error: "not_found" });
    return reply.send({ ok: true, alias });
  });

  // Remove my edge to a contact. Idempotent.
  app.delete("/contacts/:userId", { preHandler: requireAuth }, async (request, reply) => {
    const me = request.user.sub;
    const { userId } = request.params as { userId: string };

    await prisma.contact.deleteMany({
      where: { ownerUserId: me, contactUserId: userId },
    });
    return reply.send({ ok: true });
  });
}
