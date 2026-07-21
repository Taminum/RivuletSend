import { PrismaClient } from "@prisma/client";

// PrismaClient connects lazily on first query, so importing this does not
// require the database to be reachable — the server can boot without Postgres
// and only DB-touching routes will fail until it's up.
export const prisma = new PrismaClient();
