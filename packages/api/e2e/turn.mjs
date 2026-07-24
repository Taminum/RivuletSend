// /turn-credentials, end to end against a running API.
//
// The point of this endpoint is that the relay password is NOT a constant baked
// into the web bundle: it is an HMAC of an expiry timestamp, in coturn's
// shared-secret ("REST API") scheme. So the test recomputes the credential
// independently — if the derivation ever drifts from what coturn expects, every
// relayed transfer would start failing with no visible error in the app.
//
// Run against a dev API started with the same secret:
//   PORT=8083 TURN_SECRET=testsecret \
//     TURN_URLS="turn:example.com:3478?transport=udp,turn:example.com:3478?transport=tcp" \
//     pnpm --filter @p2p/api dev
//   TURN_API=http://localhost:8083 TURN_SECRET=testsecret node e2e/turn.mjs
//
// The last case exhausts the rate limit, so a re-run within a minute reports a
// false failure on the earlier checks.
import crypto from "node:crypto";

const API = process.env.TURN_API || "http://localhost:8083";
const SECRET = process.env.TURN_SECRET || "testsecret";

let failures = 0;
const check = (n, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${extra ? " — " + extra : ""}`);
  if (!ok) failures++;
};

async function main() {
  const res = await fetch(`${API}/turn-credentials`);
  check("endpoint answers 200", res.status === 200, `status ${res.status}`);
  const body = await res.json();

  const servers = body.iceServers ?? [];
  check("returns ice servers", Array.isArray(servers) && servers.length > 0);

  const stun = servers.find((s) => String(s.urls).startsWith("stun:"));
  check("includes a STUN server", Boolean(stun), stun ? String(stun.urls) : "missing");

  const turn = servers.find((s) => s.username && s.credential);
  check("includes a credentialed TURN server", Boolean(turn));
  if (!turn) {
    console.log("\nTURN not configured on this API — start it with TURN_SECRET + TURN_URLS");
    process.exit(1);
  }

  check(
    "TURN urls came through as a list",
    Array.isArray(turn.urls) && turn.urls.every((u) => u.startsWith("turn:")),
    JSON.stringify(turn.urls),
  );

  // username is "<unix expiry>:<label>"
  const [expiryPart, label] = String(turn.username).split(":");
  const expiry = Number(expiryPart);
  const now = Math.floor(Date.now() / 1000);
  check("username carries a numeric expiry", Number.isFinite(expiry), turn.username);
  check("username carries a label", Boolean(label), turn.username);
  check("credential expires in the future", expiry > now, `${expiry - now}s left`);
  check(
    "expiry matches the advertised ttl",
    Math.abs(expiry - now - body.ttl) <= 5,
    `ttl ${body.ttl}, actual ${expiry - now}`,
  );

  // The credential coturn will accept: base64(HMAC-SHA1(secret, username)).
  const expected = crypto.createHmac("sha1", SECRET).update(turn.username).digest("base64");
  check("credential is the HMAC coturn expects", turn.credential === expected);

  // A wrong secret must NOT produce the same credential, otherwise the check
  // above would pass for any implementation.
  const wrong = crypto.createHmac("sha1", `${SECRET}x`).update(turn.username).digest("base64");
  check("a different secret yields a different credential", turn.credential !== wrong);

  // Rate limit: the endpoint is unauthenticated by design (code-based
  // transfers have no session), so it must not be free to hammer.
  let sawLimit = false;
  for (let i = 0; i < 40; i++) {
    const r = await fetch(`${API}/turn-credentials`);
    if (r.status === 429) {
      sawLimit = true;
      break;
    }
  }
  check("rate limit kicks in", sawLimit);

  console.log(`\n${failures === 0 ? "ALL TURN TESTS PASSED" : failures + " FAILED"}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("TEST ERROR:", e);
  process.exit(1);
});
