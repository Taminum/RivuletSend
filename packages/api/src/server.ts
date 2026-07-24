import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import { env } from "./env";
import { registerHealthRoutes } from "./routes/health";
import { registerAuthRoutes } from "./routes/auth";
import { registerContactRoutes } from "./routes/contacts";
import { registerInternalRoutes } from "./routes/internal";
import { registerTransferRoutes } from "./routes/transfers";
import { registerPairingRoutes } from "./routes/pairing";
import { registerDeviceRoutes } from "./routes/devices";
import { registerTurnRoutes } from "./routes/turn";

const AUTH_COOKIE = "token";

async function main(): Promise<void> {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: env.WEB_ORIGIN, credentials: true });
  await app.register(cookie);
  // JWT is read from / written to an httpOnly cookie rather than a header, so an
  // injected script can't read the session token.
  await app.register(jwt, {
    secret: env.JWT_SECRET,
    cookie: { cookieName: AUTH_COOKIE, signed: false },
  });

  // API responses are per-user and some carry short-lived credentials (the
  // signaling token is valid for 2 minutes). With no explicit directive a
  // browser may heuristically cache a GET: Firefox did exactly that and kept
  // replaying a stale /auth/ws-token, which signaling then rejected as
  // "Invalid token". Never cache API responses.
  app.addHook("onSend", async (_request, reply) => {
    reply.header("cache-control", "no-store");
  });

  await registerHealthRoutes(app);
  await registerAuthRoutes(app);
  await registerContactRoutes(app);
  await registerInternalRoutes(app);
  await registerTransferRoutes(app);
  await registerPairingRoutes(app);
  await registerDeviceRoutes(app);
  await registerTurnRoutes(app);

  try {
    const address = await app.listen({ port: env.PORT, host: "0.0.0.0" });
    app.log.info(`API listening on ${address}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
