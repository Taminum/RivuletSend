// Multi-select send to TWO online contacts in sequence. This is the path that
// exercises the queue's teardown guard: after the first recipient's channel
// drains, placing the call to the second recipient tears the first channel down,
// and that teardown must not be mistaken for a failure. Both recipients must end
// up with a byte-perfect copy, and Alice's rows must both read "Sent".
//
// Prereqs: api (8081), signaling (8080), web (5173), Postgres running,
// with users alice@example.com / bob2@example.com present. A third user
// (carol@example.com) is created on first run.
import { chromium } from "playwright";

const WEB = "http://localhost:5173";
const API = "http://localhost:8081";
const FILE_NAME = "multi-two-photo.bin";
const SIZE = 96 * 1024 + 41;
const pattern = (i) => (i * 31 + 7) % 256;
const buffer = Buffer.alloc(SIZE);
for (let i = 0; i < SIZE; i++) buffer[i] = pattern(i);

const log = (...a) => console.log(...a);

async function ensureUser(browser, email, password, displayName) {
  const context = await browser.newContext();
  let res = await context.request.post(`${API}/auth/login`, { data: { email, password } });
  if (!res.ok()) {
    res = await context.request.post(`${API}/auth/signup`, {
      data: { email, password, displayName },
    });
    if (!res.ok()) throw new Error(`signup failed for ${email}: ${res.status()}`);
  }
  const { user } = await res.json();
  return { context, userId: user.id };
}

async function main() {
  const browser = await chromium.launch({
    args: ["--disable-features=WebRtcHideLocalIpsWithMdns"],
  });
  let failures = 0;
  const check = (name, ok, extra = "") => {
    log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
    if (!ok) failures++;
  };

  try {
    const alice = await ensureUser(browser, "alice@example.com", "hunter2pass", "Alice");
    const bob = await ensureUser(browser, "bob2@example.com", "bobpass1234", "Bob");
    const carol = await ensureUser(browser, "carol@example.com", "carolpass123", "Carol");

    // Mutual contacts: alice <-> bob, alice <-> carol.
    for (const [a, b] of [
      [alice, bob],
      [bob, alice],
      [alice, carol],
      [carol, alice],
    ]) {
      await a.context.request.post(`${API}/contacts`, { data: { userId: b.userId } });
    }

    const alicePage = await alice.context.newPage();
    const bobPage = await bob.context.newPage();
    const carolPage = await carol.context.newPage();
    for (const [n, p] of [
      ["alice", alicePage],
      ["bob", bobPage],
      ["carol", carolPage],
    ]) {
      p.on("console", (m) => m.type() === "error" && log(`[${n} error]`, m.text()));
    }

    await alicePage.goto(WEB);
    await bobPage.goto(WEB);
    await carolPage.goto(WEB);

    for (const p of [alicePage, bobPage, carolPage]) {
      await p.locator(".header-status .pulse-line").first().waitFor({ timeout: 20000 });
    }
    check("all three peers online", true);

    // Alice stages a file → active-send screen.
    await alicePage
      .locator(".view > input[type=file]:not([webkitdirectory])")
      .setInputFiles({ name: FILE_NAME, mimeType: "application/octet-stream", buffer });
    await alicePage.locator(".share-code").first().waitFor({ timeout: 10000 });

    // Select BOTH Bob and Carol, then send.
    const multi = alicePage.locator(".card", { hasText: "Send to contacts" });
    await multi.waitFor({ timeout: 10000 });
    const rowFor = (name) =>
      multi.locator(".file-row").filter({ has: alicePage.locator(".file-name", { hasText: new RegExp(`^${name}$`) }) });
    await rowFor("Bob").click();
    await rowFor("Carol").click();
    await multi.getByRole("button", { name: /Send to 2 contacts/ }).click();
    log("selected Bob + Carol; waiting for both to receive…");

    const integrityOf = async (page) =>
      page.evaluate(
        async ({ name, size }) => {
          const a = [...document.querySelectorAll("a[download]")].find(
            (x) => x.getAttribute("download") === name,
          );
          if (!a) return "no link";
          const bytes = new Uint8Array(await (await fetch(a.href)).arrayBuffer());
          if (bytes.length !== size) return `size mismatch: ${bytes.length}`;
          for (let i = 0; i < bytes.length; i += 997) {
            if (bytes[i] !== (i * 31 + 7) % 256) return `byte mismatch at ${i}`;
          }
          return "OK";
        },
        { name: FILE_NAME, size: SIZE },
      );

    for (const [name, page] of [
      ["Bob", bobPage],
      ["Carol", carolPage],
    ]) {
      await page
        .locator(`.global-transfers a[download="${FILE_NAME}"]`)
        .waitFor({ state: "visible", timeout: 45000 });
      const res = await integrityOf(page);
      check(`${name} received a byte-perfect copy`, res === "OK", res);
    }

    // Both of Alice's rows must read "Sent" (proves the queue advanced cleanly
    // through the mid-batch teardown rather than stalling on the first).
    for (const name of ["Bob", "Carol"]) {
      const sent = await rowFor(name)
        .locator(".hist-status.ok", { hasText: "Sent" })
        .waitFor({ timeout: 15000 })
        .then(() => true)
        .catch(() => false);
      check(`Alice's row for ${name} shows "Sent"`, sent);
    }

    try {
      const res = await alice.context.request.get(`${API}/transfers`);
      const { transfers } = await res.json();
      for (const t of transfers.filter((x) => x.fileName === FILE_NAME)) {
        await alice.context.request.delete(`${API}/transfers/${t.id}`);
      }
    } catch {
      /* best-effort */
    }
  } finally {
    await browser.close();
  }

  log(`\n${failures === 0 ? "ALL MULTI-SEND-TWO TESTS PASSED" : failures + " FAILED"}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("TEST ERROR:", err);
  process.exit(1);
});
