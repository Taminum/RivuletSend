import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Transfer, User } from "@prisma/client";
import { prisma } from "../db";
import { parseBody } from "../http";
import { requireAuth, serializeUser } from "../auth/session";

// fileSize can exceed 2^53, so accept it as a string too and store as BigInt.
const fileSizeSchema = z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)]);

const createSchema = z.object({
  recipientUserId: z.string().optional(),
  fileName: z.string().trim().min(1).max(500),
  fileSize: fileSizeSchema,
  status: z.enum(["completed", "failed"]),
  failureReason: z.string().max(200).optional(),
});

type TransferWithParties = Transfer & { sender: User; recipient: User | null };

function serializeTransfer(t: TransferWithParties, viewerId: string) {
  const direction = t.senderUserId === viewerId ? "sent" : "received";
  const counterpart = direction === "sent" ? t.recipient : t.sender;
  return {
    id: t.id,
    direction,
    fileName: t.fileName,
    fileSize: t.fileSize.toString(),
    status: t.status,
    failureReason: t.failureReason,
    createdAt: t.createdAt.toISOString(),
    counterpart: counterpart ? serializeUser(counterpart) : null,
  };
}

export async function registerTransferRoutes(app: FastifyInstance): Promise<void> {
  // Record a completed/failed transfer. The caller is always the sender.
  app.post("/transfers", { preHandler: requireAuth }, async (request, reply) => {
    const body = parseBody(createSchema, request, reply);
    if (!body) return;
    const me = request.user.sub;

    const transfer = await prisma.transfer.create({
      data: {
        senderUserId: me,
        recipientUserId: body.recipientUserId ?? null,
        fileName: body.fileName,
        fileSize: BigInt(body.fileSize),
        status: body.status,
        failureReason: body.status === "failed" ? (body.failureReason ?? null) : null,
      },
      include: { sender: true, recipient: true },
    });
    return reply.code(201).send({ transfer: serializeTransfer(transfer, me) });
  });

  // List my transfers (as either sender or recipient), newest first.
  app.get("/transfers", { preHandler: requireAuth }, async (request, reply) => {
    const me = request.user.sub;
    const transfers = await prisma.transfer.findMany({
      where: { OR: [{ senderUserId: me }, { recipientUserId: me }] },
      orderBy: { createdAt: "desc" },
      include: { sender: true, recipient: true },
      take: 200,
    });
    return reply.send({ transfers: transfers.map((t) => serializeTransfer(t, me)) });
  });

  // Delete one of my history entries. Either party may remove the shared row.
  app.delete("/transfers/:id", { preHandler: requireAuth }, async (request, reply) => {
    const me = request.user.sub;
    const { id } = request.params as { id: string };
    const result = await prisma.transfer.deleteMany({
      where: { id, OR: [{ senderUserId: me }, { recipientUserId: me }] },
    });
    if (result.count === 0) return reply.code(404).send({ error: "not_found" });
    return reply.send({ ok: true });
  });
}
