import { config } from "dotenv";
import { z } from "zod";

// Load .env before reading process.env. dotenv never overrides variables that
// are already set, so real environment config still wins in production.
config();

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(8081),
  // Local dev default matches docker-compose.yml. Override in production.
  DATABASE_URL: z
    .string()
    .default("postgresql://p2p:p2p@localhost:5432/p2p?schema=public"),
  JWT_SECRET: z.string().default("dev-insecure-secret-change-me"),
  // Web app origin, for CORS with credentials (cookies).
  WEB_ORIGIN: z.string().default("http://localhost:5173"),
  // Set true when serving over HTTPS so the auth cookie gets the Secure flag.
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  // Bot token used to verify Telegram Login Widget payloads (optional until used).
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  // Shared secret the signaling server presents to call internal endpoints
  // (e.g. mutual-contact authorization). Must match signaling's INTERNAL_SECRET.
  INTERNAL_API_SECRET: z.string().default("dev-internal-secret"),
  // STUN server handed to clients by /turn-credentials.
  STUN_URL: z.string().default("stun:stun.l.google.com:19302"),
  // TURN relay, served through /turn-credentials. TURN_SECRET must equal
  // coturn's static-auth-secret; leaving either unset simply means no relay.
  TURN_SECRET: z.string().optional(),
  TURN_URLS: z.string().optional(),
  // Lifetime of a minted TURN credential. Long enough to cover a slow transfer
  // that starts near expiry, short enough that a leaked one goes stale.
  TURN_TTL: z.coerce.number().default(12 * 60 * 60),
});

export const env = schema.parse(process.env);

if (env.NODE_ENV === "production" && env.JWT_SECRET === "dev-insecure-secret-change-me") {
  throw new Error("JWT_SECRET must be set to a strong value in production");
}
