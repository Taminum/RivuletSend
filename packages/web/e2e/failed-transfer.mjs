// Verifies a failed transfer is recorded with a reason: Alice starts a large
// contact transfer to Bob, Bob's page is closed mid-transfer, and Alice's
// history should gain a `failed` row with a human-readable reason.
import { chromium } from "playwright";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const WEB = "http://localhost:5173";
const API = "http://localhost:8081";
const FILE_NAME = "big-interrupted.bin";
const SIZE = 120 * 1024 * 1024; // large enough to still be transferring when we close Bob

// Playwright can't pass a >50MB buffer inline; write it to disk and use the path.
const filePath = join(tmpdir(), FILE_NAME);
writeFileSync(filePath, Buffer.alloc(SIZE));

async function login(browser, email, password) {
  const context = await browser.newContext();
  const res = await context.request.post(`${API}/auth/login`, { data: { email, password } });
  if (!res.ok()) throw new Error(`login ${email}: ${res.status()}`);
  const { user } = await res.json();
  return { context, userId: user.id };
}

async function main() {
  const browser = await chromium.launch({ args: ["--disable-features=WebRtcHideLocalIpsWithMdns"] });
  let failures = 0;
  const check = (n, ok, extra = "") => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${n}${extra ? " — " + extra : ""}`);
    if (!ok) failures++;
  };

  try {
    const alice = await login(browser, "alice@example.com", "hunter2pass");
    const bob = await login(browser, "bob2@example.com", "bobpass1234");
    await alice.context.request.post(`${API}/contacts`, { data: { userId: bob.userId } });
    await bob.context.request.post(`${API}/contacts`, { data: { userId: alice.userId } });

    // Clean any prior rows for this filename.
    const pre = await alice.context.request.get(`${API}/transfers`);
    for (const t of (await pre.json()).transfers.filter((x) => x.fileName === FILE_NAME)) {
      await alice.context.request.delete(`${API}/transfers/${t.id}`);
    }

    const alicePage = await alice.context.newPage();
    const bobPage = await bob.context.newPage();
    await alicePage.goto(WEB);
    await bobPage.goto(WEB);
    await alicePage.getByRole("button", { name: "Contacts", exact: true }).click();
    await bobPage.getByRole("button", { name: "Contacts", exact: true }).click();
    await alicePage.locator(".header-status .pulse-line").first().waitFor({ timeout: 20000 });
    await bobPage.locator(".header-status .pulse-line").first().waitFor({ timeout: 20000 });

    const sendBtn = alicePage
      .locator(".file-row", { hasText: "bob2@example.com" })
      .getByRole("button", { name: "Send" });
    const [chooser] = await Promise.all([alicePage.waitForEvent("filechooser"), sendBtn.click()]);
    await chooser.setFiles(filePath);

    // Let the transfer get underway, then kill Bob mid-flight.
    await alicePage.waitForTimeout(400);
    await bobPage.close();
    console.log("closed Bob mid-transfer; waiting for Alice to record the failure…");

    // Poll Alice's history for a failed row with a reason.
    let failedRow = null;
    for (let i = 0; i < 30; i++) {
      const res = await alice.context.request.get(`${API}/transfers`);
      const { transfers } = await res.json();
      failedRow = transfers.find((t) => t.fileName === FILE_NAME && t.status === "failed");
      if (failedRow) break;
      await alicePage.waitForTimeout(500);
    }

    check("failed transfer recorded", !!failedRow, failedRow ? "" : "no failed row appeared");
    check(
      "failure has a human-readable reason",
      !!failedRow && typeof failedRow.failureReason === "string" && failedRow.failureReason.length > 0,
      failedRow ? `reason="${failedRow.failureReason}"` : "",
    );
    check(
      "failed row shows in Alice's History UI with the reason",
      await (async () => {
        await alicePage.getByRole("button", { name: "History", exact: true }).click();
        const tag = alicePage.locator(".failed-tag").first();
        return tag
          .waitFor({ timeout: 5000 })
          .then(() => tag.textContent())
          .then((tx) => !!tx && tx.toLowerCase().includes("failed"))
          .catch(() => false);
      })(),
    );

    // Cleanup.
    if (failedRow) await alice.context.request.delete(`${API}/transfers/${failedRow.id}`);
  } finally {
    await browser.close();
    try {
      unlinkSync(filePath);
    } catch {
      /* ignore */
    }
  }

  console.log(`\n${failures === 0 ? "ALL FAILED-TRANSFER TESTS PASSED" : failures + " FAILED"}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("TEST ERROR:", e);
  process.exit(1);
});
