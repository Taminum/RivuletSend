import type { FastifyInstance } from "fastify";
import { prisma } from "../db";

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  // Liveness: proves the process is up. Never touches the database.
  app.get("/health", async () => ({ status: "ok" }));

  // Readiness: pings the database so orchestrators can tell "up" from "usable".
  app.get("/health/db", async (_req, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: "ok", db: "connected" };
    } catch {
      reply.code(503);
      return { status: "error", db: "unavailable" };
    }
  });
}
