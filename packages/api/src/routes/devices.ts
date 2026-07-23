import type { FastifyInstance } from "fastify";
import { prisma } from "../db";
import { requireAuth } from "../auth/session";

// Managing the current account's linked (paired) devices.
export async function registerDeviceRoutes(app: FastifyInstance): Promise<void> {
  // List active devices, newest-seen first, flagging the one making the request.
  app.get("/devices", { preHandler: requireAuth }, async (request, reply) => {
    const devices = await prisma.device.findMany({
      where: { userId: request.user.sub, revokedAt: null },
      orderBy: { lastSeenAt: "desc" },
    });
    return reply.send({
      devices: devices.map((d) => ({
        id: d.id,
        label: d.label,
        platform: d.platform,
        createdAt: d.createdAt.toISOString(),
        lastSeenAt: d.lastSeenAt.toISOString(),
        isCurrent: d.id === request.user.did,
      })),
    });
  });

  // Revoke a device. Setting revokedAt invalidates its session on the very next
  // request (requireAuth checks it), so it can't keep acting until token expiry.
  app.post<{ Params: { id: string } }>(
    "/devices/:id/revoke",
    { preHandler: requireAuth },
    async (request, reply) => {
      const device = await prisma.device.findUnique({ where: { id: request.params.id } });
      if (!device || device.userId !== request.user.sub) {
        return reply.code(404).send({ error: "not_found" });
      }
      if (!device.revokedAt) {
        await prisma.device.update({ where: { id: device.id }, data: { revokedAt: new Date() } });
      }
      return reply.send({ ok: true });
    },
  );
}
