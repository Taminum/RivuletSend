import crypto from "node:crypto";

// Fields Telegram's Login Widget sends back. `hash` authenticates the rest.
export interface TelegramAuthData {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

// Reject payloads older than this to blunt replay of a captured login.
const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60;

// Verifies the signed payload per https://core.telegram.org/widgets/login.
// This check — not the mere presence of an `id` — is what authenticates the
// user, so it must never be skipped.
export function verifyTelegramAuth(data: TelegramAuthData, botToken: string): boolean {
  const { hash, ...fields } = data;

  const dataCheckString = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${(fields as Record<string, unknown>)[key]}`)
    .join("\n");

  const secretKey = crypto.createHash("sha256").update(botToken).digest();
  const expected = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;

  const ageSeconds = Math.floor(Date.now() / 1000) - data.auth_date;
  return ageSeconds >= 0 && ageSeconds < MAX_AUTH_AGE_SECONDS;
}
