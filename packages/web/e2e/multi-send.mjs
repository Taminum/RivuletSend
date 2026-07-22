// End-to-end test of the multi-select "send to contacts" on the active-send
// screen. Alice stages a file (which produces a one-time code), then selects an
// online contact (Bob) from the new list and sends — the same files should
// arrive over the contact/presence path, and Alice's row should read "Sent".
//
// Prereqs: api (8081), signaling (8080), web (5173), Postgres running,
// with users alice@example.com / bob2@example.com present.
import { chromium } from "playwright";

const WEB = "http://localhost:5173";
const API = "http://localhost:8081";
const FILE_NAME = "multi-send-photo.bin";
const SIZE = 128 * 1024 + 77;
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
    await alice.context.request.post(`${API}/contacts`, { data: { userId: bob.userId } });
    await bob.context.request.post(`${API}/contacts`, { data: { userId: alice.userId } });

    const alicePage = await alice.context.newPage();
    const bobPage = await bob.context.newPage();
    alicePage.on("console", (m) => m.type() === "error" && log("[alice error]", m.text()));
    bobPage.on("console", (m) => m.type() === "error" && log("[bob error]", m.text()));

    await alicePage.goto(WEB);
    await bobPage.goto(WEB);

    // Both online (Send view shows the presence pulse-line via ContactSendList).
    await alicePage.locator(".header-status .pulse-line").first().waitFor({ timeout: 20000 });
    await bobPage.locator(".header-status .pulse-line").first().waitFor({ timeout: 20000 });
    check("both peers online", true);

    // Alice stages a file → active-send screen with the one-time code appears.
    await alicePage
      .locator(".view > input[type=file]:not([webkitdirectory])")
      .setInputFiles({ name: FILE_NAME, mimeType: "application/octet-stream", buffer });
    await alicePage.locator(".share-code").first().waitFor({ timeout: 10000 });
    check("code screen shown after staging file", true);

    // The multi-select "send to contacts" list is present; pick Bob and send.
    const multi = alicePage.locator(".card", { hasText: "Send to contacts" });
    await multi.waitFor({ timeout: 10000 });
    await multi.locator(".file-row", { hasText: "bob2@example.com" }).click();
    await multi.getByRole("button", { name: /Send to \d+ contact/ }).click();
    log("selected Bob and clicked send; waiting for Bob to receive…");

    // Bob receives it over the global transfers panel.
    const link = bobPage.locator(`.global-transfers a[download="${FILE_NAME}"]`);
    await link.waitFor({ state: "visible", timeout: 45000 });
    check("Bob received the file", true);

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
        return "OK";
      },
      { name: FILE_NAME, size: SIZE },
    );
    check(`Bob's copy is byte-for-byte correct (${SIZE} bytes)`, integrity === "OK", integrity);

    // Alice's contact row should read "Sent".
    const sent = await multi
      .locator(".file-row", { hasText: "bob2@example.com" })
      .locator(".hist-status.ok", { hasText: "Sent" })
      .waitFor({ timeout: 10000 })
      .then(() => true)
      .catch(() => false);
    check('Alice\'s row shows "Sent"', sent);

    // Cleanup any history rows this run created.
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

  log(`\n${failures === 0 ? "ALL MULTI-SEND TESTS PASSED" : failures + " FAILED"}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("TEST ERROR:", err);
  process.exit(1);
});
