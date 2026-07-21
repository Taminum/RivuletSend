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

  await registerHealthRoutes(app);
  await registerAuthRoutes(app);
  await registerContactRoutes(app);
  await registerInternalRoutes(app);
  await registerTransferRoutes(app);

  try {
    const address = await app.listen({ port: env.PORT, host: "0.0.0.0" });
    app.log.info(`API listening on ${address}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
