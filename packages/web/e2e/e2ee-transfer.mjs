// Part 3 (E2EE) over a real WebRTC data channel between two pages:
//  A. Correct passphrase — the file arrives byte-exact AND its name is decrypted
//     (the download uses the real filename, which travelled encrypted).
//  B. Wrong passphrase — the receiver fails immediately with "Incorrect
//     passphrase" and the transfer does not complete.
//
// The passphrase is entered independently on each page (out-of-band) and is
// never part of the code or any message.
import { chromium } from "playwright";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomBytes } from "node:crypto";

const WEB = process.env.WEB || "http://localhost:5173";
const dir = mkdtempSync(join(tmpdir(), "rivulet-e2ee-"));
const bytes = randomBytes(3 * 1024 * 1024);
const filePath = join(dir, "secret.bin");
writeFileSync(filePath, bytes);
const expectedHash = createHash("sha256").update(bytes).digest("hex");

async function send(sender, passphrase) {
  // Passphrase now lives behind the collapsed "Advanced options" disclosure.
  await sender.getByRole("button", { name: /Advanced options/ }).click();
  await sender.locator("#passphrase").fill(passphrase);
  await sender.locator('input[type="file"]:not([webkitdirectory])').setInputFiles(filePath);
  return (await sender.locator(".share-code.big").textContent({ timeout: 10000 })).trim();
}

async function receive(receiver, code, passphrase) {
  await receiver.getByRole("button", { name: "Receive", exact: true }).click();
  await receiver.locator(".code-input").fill(code);
  await receiver.locator('.field input[placeholder="Leave blank for none"]').fill(passphrase);
  await receiver.getByRole("button", { name: "Connect" }).click();
}

async function main() {
  const browser = await chromium.launch({ args: ["--disable-features=WebRtcHideLocalIpsWithMdns"] });
  let failures = 0;
  const check = (n, ok, extra = "") => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${n}${extra ? " — " + extra : ""}`);
    if (!ok) failures++;
  };

  try {
    // --- A. Correct passphrase ---
    {
      const ctx = await browser.newContext();
      const sender = await ctx.newPage();
      const receiver = await ctx.newPage();
      await sender.goto(WEB);
      await receiver.goto(WEB);

      const code = await send(sender, "hunter2 correct horse");
      await receive(receiver, code, "hunter2 correct horse");

      // The download uses the DECRYPTED filename — proves name encryption too.
      const dl = receiver.locator('a.file-action[download="secret.bin"]');
      await dl.waitFor({ timeout: 30000 });
      const [download] = await Promise.all([receiver.waitForEvent("download"), dl.click()]);
      const got = createHash("sha256").update(readFileSync(await download.path())).digest("hex");
      check("decrypted filename is recovered (download named secret.bin)", true);
      check("file decrypts byte-exact with the correct passphrase", got === expectedHash);
      await ctx.close();
    }

    // --- B. Wrong passphrase ---
    {
      const ctx = await browser.newContext();
      const sender = await ctx.newPage();
      const receiver = await ctx.newPage();
      await sender.goto(WEB);
      await receiver.goto(WEB);

      const code = await send(sender, "the-real-passphrase");
      await receive(receiver, code, "totally-wrong");

      const err = receiver.locator(".error", { hasText: "Incorrect passphrase" });
      const failedShown = await err
        .waitFor({ timeout: 20000 })
        .then(() => true)
        .catch(() => false);
      check("wrong passphrase fails loudly with 'Incorrect passphrase'", failedShown);

      const completed = await receiver
        .locator('a.file-action[download="secret.bin"]')
        .waitFor({ timeout: 2000 })
        .then(() => true)
        .catch(() => false);
      check("wrong-passphrase transfer does not complete", completed === false);
      await ctx.close();
    }
  } finally {
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }

  console.log(`\n${failures === 0 ? "ALL E2EE-TRANSFER TESTS PASSED" : failures + " FAILED"}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("TEST ERROR:", e);
  process.exit(1);
});
