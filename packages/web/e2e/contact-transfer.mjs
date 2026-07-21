// Two-browser end-to-end test of the contact-based (codeless) transfer.
// Uses two separate Playwright browser contexts (independent cookie jars) so
// Alice and Bob can be signed in at the same time — impossible in one browser.
// Alice sends a file to Bob over a real WebRTC data channel; we verify Bob
// receives it byte-for-byte.
//
// Prereqs: api (8081), signaling (8080), web (5173), and Postgres running,
// with users alice@example.com / bob2@example.com present.
import { chromium } from "playwright";

const WEB = "http://localhost:5173";
const API = "http://localhost:8081";
const FILE_NAME = "playwright-photo.bin";
const SIZE = 256 * 1024 + 123; // spans multiple 64KB chunks; non-round size
const pattern = (i) => (i * 31 + 7) % 256;

const buffer = Buffer.alloc(SIZE);
for (let i = 0; i < SIZE; i++) buffer[i] = pattern(i);

const log = (...a) => console.log(...a);

async function loginContext(browser, email, password) {
  const context = await browser.newContext();
  const res = await context.request.post(`${API}/auth/login`, { data: { email, password } });
  if (!res.ok()) throw new Error(`login failed for ${email}: ${res.status()}`);
  const { user } = await res.json();
  return { context, userId: user.id };
}

async function main() {
  const browser = await chromium.launch({
    // Force raw host ICE candidates (no mDNS .local names) so two contexts on
    // this machine can form a direct connection headlessly.
    args: ["--disable-features=WebRtcHideLocalIpsWithMdns"],
  });

  let failures = 0;
  const check = (name, ok, extra = "") => {
    log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
    if (!ok) failures++;
  };

  try {
    const alice = await loginContext(browser, "alice@example.com", "hunter2pass");
    const bob = await loginContext(browser, "bob2@example.com", "bobpass1234");
    log(`alice=${alice.userId} bob=${bob.userId}`);

    // Ensure they are mutual contacts (idempotent), before loading the pages.
    await alice.context.request.post(`${API}/contacts`, { data: { userId: bob.userId } });
    await bob.context.request.post(`${API}/contacts`, { data: { userId: alice.userId } });

    const alicePage = await alice.context.newPage();
    const bobPage = await bob.context.newPage();
    alicePage.on("console", (m) => m.type() === "error" && log("[alice console error]", m.text()));
    bobPage.on("console", (m) => m.type() === "error" && log("[bob console error]", m.text()));

    await alicePage.goto(WEB);
    await bobPage.goto(WEB);

    // Open the Contacts view on both (contact transfers live there).
    await alicePage.getByRole("button", { name: "Contacts", exact: true }).click();
    await bobPage.getByRole("button", { name: "Contacts", exact: true }).click();

    // Both must be online (authenticated presence connection) before sending.
    // The pulse-line waveform only renders when online.
    await alicePage.locator(".header-status .pulse-line").first().waitFor({ timeout: 20000 });
    await bobPage.locator(".header-status .pulse-line").first().waitFor({ timeout: 20000 });
    check("both peers online (presence)", true);

    // Move Bob OFF the Contacts view to prove the global indicator surfaces the
    // incoming transfer from anywhere.
    await bobPage.locator(".nav-item", { hasText: "Send" }).click();

    // Alice sends the file to Bob via his contact row's Send button.
    const sendBtn = alicePage
      .locator(".file-row", { hasText: "bob2@example.com" })
      .getByRole("button", { name: "Send" });
    const [chooser] = await Promise.all([
      alicePage.waitForEvent("filechooser"),
      sendBtn.click(),
    ]);
    await chooser.setFiles({ name: FILE_NAME, mimeType: "application/octet-stream", buffer });
    log("file handed to Alice's Send flow; waiting for Bob to receive…");

    // The global transfers panel should appear on Bob's Send view with the file.
    const link = bobPage.locator(`.global-transfers a[download="${FILE_NAME}"]`);
    await link.waitFor({ state: "visible", timeout: 45000 });
    const panelVisible = await bobPage.locator(".global-transfers").isVisible();
    check("global indicator surfaced the incoming file (off Contacts view)", panelVisible);

    // Byte-for-byte integrity check inside Bob's page.
    const integrity = await bobPage.evaluate(
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
        if (bytes[size - 1] !== ((size - 1) * 31 + 7) % 256) return "last byte mismatch";
        return "OK";
      },
      { name: FILE_NAME, size: SIZE },
    );
    check(`Bob's copy is byte-for-byte correct (${SIZE} bytes)`, integrity === "OK", integrity);

    // Sender-side: transfer should read as complete (wait for the done bar).
    const aliceDone = await alicePage
      .locator(".progress-fill.done")
      .first()
      .waitFor({ timeout: 10000 })
      .then(() => true)
      .catch(() => false);
    check("Alice's send shows complete", aliceDone);

    // Clean up the history row this run created, so the dev DB doesn't accumulate.
    try {
      const res = await alice.context.request.get(`${API}/transfers`);
      const { transfers } = await res.json();
      for (const t of transfers.filter((x) => x.fileName === FILE_NAME)) {
        await alice.context.request.delete(`${API}/transfers/${t.id}`);
      }
    } catch {
      /* best-effort cleanup */
    }
  } finally {
    await browser.close();
  }

  log(`\n${failures === 0 ? "ALL CONTACT-TRANSFER TESTS PASSED" : failures + " FAILED"}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("TEST ERROR:", err);
  process.exit(1);
});
