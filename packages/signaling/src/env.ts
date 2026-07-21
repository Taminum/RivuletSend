import { config } from "dotenv";

// Load .env for local dev. Real environment variables still take precedence.
config();

export const env = {
  PORT: Number(process.env.PORT ?? 8080),
  // Must match the API's JWT_SECRET so tokens it issues verify here.
  JWT_SECRET: process.env.JWT_SECRET ?? "dev-insecure-secret-change-me",
  // Must match the API's INTERNAL_API_SECRET for internal authz calls.
  INTERNAL_SECRET: process.env.INTERNAL_SECRET ?? "dev-internal-secret",
  API_INTERNAL_URL: process.env.API_INTERNAL_URL ?? "http://localhost:8081",
};
