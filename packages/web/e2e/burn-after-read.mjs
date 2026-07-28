// Burn-after-read: a code created with the checkbox is invalidated by the
// SIGNALING SERVER once one full transfer completes — a client-side hide isn't
// enough, since someone could just reconnect with the same code. Here a third
// party tries the code after the transfer finishes and is rejected server-side.
import { chromium } from "playwright";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const WEB = process.env.WEB || "http://localhost:5199";
const dir = mkdtempSync(join(tmpdir(), "rivulet-burn-"));
const file = join(dir, "secret.bin");
writeFileSync(file, Buffer.alloc(64 * 1024, 7));

async function main() {
  const browser = await chromium.launch({ args: ["--disable-features=WebRtcHideLocalIpsWithMdns"] });
  let failures = 0;
  const check = (n, ok, extra = "") => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${n}${extra ? " — " + extra : ""}`);
    if (!ok) failures++;
  };

  try {
    const ctx = await browser.newContext();
    const sender = await ctx.newPage();
    await sender.goto(WEB);

    // Create a one-shot (burn-after-read) link.
    await sender.locator(".burn-check input[type=checkbox]").check();
    await sender.locator('input[type="file"]:not([webkitdirectory])').setInputFiles(file);
    const code = (await sender.locator(".share-code.big").textContent({ timeout: 10000 })).trim();
    check("burn link created", /^[A-Z0-9]{8}$/.test(code), code);

    // First recipient completes the transfer (this reports completion to signaling).
    const r1 = await ctx.newPage();
    await r1.goto(WEB);
    await r1.getByRole("button", { name: "Receive", exact: true }).click();
    await r1.locator(".code-input").fill(code);
    await r1.getByRole("button", { name: "Connect" }).click();
    await r1.locator('a.file-action[download="secret.bin"]').waitFor({ timeout: 30000 });
    check("first recipient received the file", true);

    // Give the transfer-complete signal a moment to reach the server.
    await new Promise((r) => setTimeout(r, 800));

    // Second recipient tries the same code — server must reject it.
    const r2 = await ctx.newPage();
    await r2.goto(WEB);
    await r2.getByRole("button", { name: "Receive", exact: true }).click();
    await r2.locator(".code-input").fill(code);
    await r2.getByRole("button", { name: "Connect" }).click();

    const used = await r2
      .locator(".error", { hasText: "already been used" })
      .waitFor({ timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    check("reused burn link is rejected server-side", used);
  } finally {
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }

  console.log(`\n${failures === 0 ? "ALL BURN-AFTER-READ TESTS PASSED" : failures + " FAILED"}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("TEST ERROR:", e);
  process.exit(1);
});
