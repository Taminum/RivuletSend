// Device pairing, end to end against the running API. Covers the full flow, the
// single-use guard, the expiry state, and — most importantly — that revoking a
// device rejects its very next request (not just at token expiry).
//
// Run against a dev API with a short pairing TTL, e.g.:
//   PORT=8082 PAIRING_TTL_MS=2000 pnpm --filter @p2p/api dev
//   PAIR_API=http://localhost:8082 node e2e/pairing.mjs
const API = process.env.PAIR_API || "http://localhost:8082";

let failures = 0;
const check = (n, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${extra ? " — " + extra : ""}`);
  if (!ok) failures++;
};

// Minimal cookie jar: capture Set-Cookie, send it back as Cookie.
function jar() {
  let cookie = "";
  return {
    get cookie() {
      return cookie;
    },
    async fetch(path, opts = {}) {
      const res = await fetch(API + path, {
        ...opts,
        headers: {
          ...(opts.body ? { "content-type": "application/json" } : {}),
          ...(cookie ? { cookie } : {}),
          ...opts.headers,
        },
      });
      const sc = res.headers.getSetCookie?.() ?? [];
      for (const c of sc) {
        const kv = c.split(";")[0];
        if (kv.startsWith("token=")) cookie = kv;
      }
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null };
    },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // Approver: an already-signed-in device (Alice, via password).
  const approver = jar();
  const login = await approver.fetch("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "alice@example.com", password: "hunter2pass" }),
  });
  check("approver signed in", login.status === 200, JSON.stringify(login.body));

  // Fresh device: no session yet.
  const device = jar();

  // 1. Fresh device requests a code.
  const req = await device.fetch("/pairing/request", {
    method: "POST",
    body: JSON.stringify({ platform: "windows", label: "Test PC" }),
  });
  check("fresh device got a 6-digit code", /^\d{6}$/.test(req.body?.code ?? ""), JSON.stringify(req.body));
  const code = req.body.code;

  // 2a. Approver sees what it's approving.
  const info = await approver.fetch(`/pairing/${code}/info`);
  check("approver sees requester platform", info.body?.requestedPlatform === "windows", JSON.stringify(info.body));

  // Status while pending.
  const pending = await device.fetch(`/pairing/${code}/status`);
  check("status pending before approval", pending.body?.status === "pending");

  // 2b. Approve.
  const approve = await approver.fetch("/pairing/approve", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
  check("approve succeeded", approve.status === 200 && approve.body?.ok === true, JSON.stringify(approve.body));

  // 3. Fresh device claims its session by polling — no password ever typed.
  const claim = await device.fetch(`/pairing/${code}/status`);
  check("device claimed session", claim.body?.status === "approved", JSON.stringify(claim.body));
  check("claim returned the account", claim.body?.user?.displayName === "Alice");
  check("device now has a session cookie", device.cookie.startsWith("token="));

  const me = await device.fetch("/auth/me");
  check("paired device is authenticated", me.status === 200 && me.body?.user?.displayName === "Alice");

  // Devices list shows the new device.
  const list = await approver.fetch("/devices");
  const found = (list.body?.devices ?? []).find((d) => d.label === "Test PC");
  check("device appears in the account's device list", Boolean(found), JSON.stringify(list.body));
  check("device platform recorded", found?.platform === "windows");

  // Single-use: re-polling the same code must NOT re-issue.
  const reclaim = await device.fetch(`/pairing/${code}/status`);
  check("code is single-use (re-poll expired)", reclaim.body?.status === "expired", JSON.stringify(reclaim.body));

  // --- Revoke: the device's NEXT request must be rejected immediately. ---
  const before = await device.fetch("/auth/me");
  check("device still works before revoke", before.status === 200);

  const revoke = await approver.fetch(`/devices/${found.id}/revoke`, { method: "POST" });
  check("revoke succeeded", revoke.status === 200 && revoke.body?.ok === true);

  const after = await device.fetch("/auth/me");
  check("revoked device rejected on next request", after.status === 401, JSON.stringify(after));
  check("rejection reason is device_revoked", after.body?.error === "device_revoked");

  const listAfter = await approver.fetch("/devices");
  check("revoked device gone from list", !(listAfter.body?.devices ?? []).some((d) => d.id === found.id));

  // --- Expiry: a code past its TTL yields a clear expired state, not a hang. ---
  const req2 = await device.fetch("/pairing/request", {
    method: "POST",
    body: JSON.stringify({ platform: "windows" }),
  });
  const code2 = req2.body.code;
  const ttl = Number(process.env.PAIRING_TTL_MS) || 2000;
  await sleep(ttl + 800);
  const expired = await device.fetch(`/pairing/${code2}/status`);
  check("expired code reports expired (no hang)", expired.body?.status === "expired", JSON.stringify(expired.body));
  const approveExpired = await approver.fetch("/pairing/approve", {
    method: "POST",
    body: JSON.stringify({ code: code2 }),
  });
  check("approving an expired code is rejected", approveExpired.status === 404);

  console.log(`\n${failures === 0 ? "ALL PAIRING TESTS PASSED" : failures + " FAILED"}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("TEST ERROR:", e);
  process.exit(1);
});
