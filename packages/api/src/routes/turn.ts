import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { env } from "../env";

// ICE configuration is served at runtime rather than baked into the web bundle,
// because the TURN relay needs a *credential*. A static username/password
// compiled into public JavaScript is readable by anyone who opens devtools,
// which turns a self-hosted relay into free bandwidth for strangers.
//
// coturn's shared-secret scheme (run with --use-auth-secret) avoids that: the
// server never stores per-user credentials, it derives them. The username is an
// expiry timestamp and the password is an HMAC of that username under a secret
// only coturn and this API know. Leaked credentials stop working on their own.

const TURN_LIMIT = 30; // requests
const TURN_WINDOW_MS = 60_000; // per IP per minute

const hits = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now > entry.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + TURN_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > TURN_LIMIT;
}

// Expired buckets would otherwise accumulate one entry per IP forever.
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of hits) {
    if (now > entry.resetAt) hits.delete(ip);
  }
}, TURN_WINDOW_MS).unref();

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export function mintTurnCredential(secret: string, ttlSeconds: number): {
  username: string;
  credential: string;
} {
  const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;
  // coturn parses everything left of the ':' as the expiry; the suffix is a
  // free-form label it does not interpret.
  const username = `${expiry}:rivulet`;
  const credential = crypto.createHmac("sha1", secret).update(username).digest("base64");
  return { username, credential };
}

export async function registerTurnRoutes(app: FastifyInstance): Promise<void> {
  // Deliberately unauthenticated: code-based transfers have no account, and
  // they need the relay just as much as signed-in users do.
  app.get("/turn-credentials", async (request, reply) => {
    if (rateLimited(request.ip)) {
      return reply.code(429).send({ error: "rate_limited" });
    }

    const iceServers: IceServerConfig[] = [{ urls: env.STUN_URL }];

    if (env.TURN_SECRET && env.TURN_URLS) {
      const urls = env.TURN_URLS.split(",")
        .map((u) => u.trim())
        .filter(Boolean);
      if (urls.length > 0) {
        const { username, credential } = mintTurnCredential(env.TURN_SECRET, env.TURN_TTL);
        iceServers.push({ urls, username, credential });
      }
    }

    return { iceServers, ttl: env.TURN_TTL };
  });
}
