// Verifies folder sending over the web (zip fallback receive path):
// a nested folder with an empty subfolder and mixed file sizes is sent by code,
// received, and downloaded as a .zip whose structure/content is verified.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { unzipSync, strFromU8 } from "fflate";

const WEB = "http://localhost:5173";
const folderName = "myfolder";
const root = join(tmpdir(), "rivulet-folder-" + Date.now());
const base = join(root, folderName);
mkdirSync(join(base, "sub", "deep"), { recursive: true });
mkdirSync(join(base, "empty"), { recursive: true }); // empty subfolder — should be skipped
writeFileSync(join(base, "a.txt"), "hello A");
writeFileSync(join(base, "sub", "b.txt"), "hello B nested");
writeFileSync(join(base, "sub", "deep", "c.bin"), Buffer.alloc(300 * 1024, 7)); // large file among tiny ones
writeFileSync(join(base, "tiny1.txt"), "1");
writeFileSync(join(base, "tiny2.txt"), "2");

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
    const receiver = await ctx.newPage();
    await sender.goto(WEB);
    await receiver.goto(WEB);

    // Sender: upload the folder via the webkitdirectory input (Playwright sets relative paths).
    await sender.locator("input[webkitdirectory]").setInputFiles(base);
    const code = (await sender.locator(".share-code.big").textContent({ timeout: 10000 })).trim();
    check("folder send created a code", /^[A-Z0-9]{8}$/.test(code), code);

    // Receiver: enter the code and connect.
    await receiver.getByRole("button", { name: "Receive", exact: true }).click();
    await receiver.locator(".code-input").fill(code);
    await receiver.getByRole("button", { name: "Connect" }).click();

    // Wait for the folder to arrive (Download .zip button appears).
    const zipBtn = receiver.getByRole("button", { name: "Download .zip" });
    await zipBtn.waitFor({ timeout: 40000 });
    check("receiver shows the completed folder with a zip action", true);

    // Download the zip and inspect it.
    const [download] = await Promise.all([receiver.waitForEvent("download"), zipBtn.click()]);
    const zipPath = await download.path();
    const unzipped = unzipSync(new Uint8Array(readFileSync(zipPath)));
    const names = Object.keys(unzipped).sort();

    const expected = [
      `${folderName}/a.txt`,
      `${folderName}/sub/b.txt`,
      `${folderName}/sub/deep/c.bin`,
      `${folderName}/tiny1.txt`,
      `${folderName}/tiny2.txt`,
    ].sort();
    check("zip has exactly the expected files (nested preserved)", JSON.stringify(names) === JSON.stringify(expected), names.join(", "));
    check("empty subfolder was skipped", !names.some((n) => n.includes("/empty")));
    check("nested text content correct", strFromU8(unzipped[`${folderName}/sub/b.txt`]) === "hello B nested");
    check("large file intact (300KB)", unzipped[`${folderName}/sub/deep/c.bin`]?.length === 300 * 1024);
  } finally {
    await browser.close();
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }

  console.log(`\n${failures === 0 ? "ALL FOLDER-TRANSFER TESTS PASSED" : failures + " FAILED"}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("TEST ERROR:", e);
  process.exit(1);
});
