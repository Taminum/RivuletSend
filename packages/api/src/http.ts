import type { FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";

// Validates request.body against a zod schema, sending a 400 and returning null
// on failure so callers can `if (!data) return;`.
export function parseBody<S extends z.ZodTypeAny>(
  schema: S,
  request: FastifyRequest,
  reply: FastifyReply,
): z.infer<S> | null {
  const result = schema.safeParse(request.body);
  if (!result.success) {
    reply.code(400).send({ error: "invalid_input", details: result.error.flatten() });
    return null;
  }
  return result.data;
}
