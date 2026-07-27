// Part 1 (OPFS receive storage), two ways:
//
//  A. Byte-exact transfer through the OPFS path. Playwright's Chromium HAS the
//     File System Access API, so the OPFS path would normally be skipped; the
//     receiver deletes window.showDirectoryPicker before load to force it (OPFS
//     itself is still supported in Chromium). A multi-MB file is sent by code,
//     received to OPFS on disk, downloaded, and its sha256 compared — and we
//     confirm an OPFS temp file actually existed (proving it wasn't the
//     in-memory path). True flat-memory on a 2GB+ file is the manual check.
//
//  B. Orphan sweep. A stale in-progress OPFS temp file (a crashed transfer)
//     plus a fresh live one are planted; after a reload the startup sweep must
//     delete the stale one and keep the live one.
import { chromium } from "playwright";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomBytes } from "node:crypto";

const WEB = process.env.WEB || "http://localhost:5173";
const SIZE = 16 * 1024 * 1024; // 256 chunks — meaningfully multi-chunk, still fast

const dir = mkdtempSync(join(tmpdir(), "rivulet-opfs-"));
const filePath = join(dir, "big.bin");
const bytes = randomBytes(SIZE);
writeFileSync(filePath, bytes);
const expectedHash = createHash("sha256").update(bytes).digest("hex");

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
    // Force the OPFS path: no File System Access API -> shouldUseOpfs() is true.
    await receiver.addInitScript(() => {
      // @ts-ignore
      delete window.showDirectoryPicker;
    });
    await sender.goto(WEB);
    await receiver.goto(WEB);

    const forced = await receiver.evaluate(
      () => !("showDirectoryPicker" in window) && typeof navigator.storage?.getDirectory === "function",
    );
    check("receiver is on the OPFS path (no FSA, OPFS supported)", forced);

    // --- A. Transfer ---
    await sender.locator('input[type="file"]:not([webkitdirectory])').setInputFiles(filePath);
    const code = (await sender.locator(".share-code.big").textContent({ timeout: 10000 })).trim();
    check("send created a code", /^[A-Z0-9]{8}$/.test(code), code);

    await receiver.getByRole("button", { name: "Receive", exact: true }).click();
    await receiver.locator(".code-input").fill(code);
    await receiver.getByRole("button", { name: "Connect" }).click();

    const dl = receiver.locator('a.file-action[download="big.bin"]');
    await dl.waitFor({ timeout: 60000 });

    // An OPFS temp file must exist for this receive (proves the disk path ran).
    const opfsCount = await receiver.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      let n = 0;
      // @ts-ignore keys() may be untyped
      for await (const _ of root.keys()) n++;
      return n;
    });
    check("an OPFS temp file was created for the receive", opfsCount >= 1, `files=${opfsCount}`);

    const [download] = await Promise.all([receiver.waitForEvent("download"), dl.click()]);
    const gotHash = createHash("sha256").update(readFileSync(await download.path())).digest("hex");
    check("downloaded file hash matches (byte-exact through OPFS)", gotHash === expectedHash);

    // --- B. Orphan sweep ---
    const sweeper = await ctx.newPage();
    await sweeper.goto(WEB);
    await sweeper.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const write = async (name, content) => {
        const fh = await root.getFileHandle(name, { create: true });
        const w = await fh.createWritable();
        await w.write(content);
        await w.close();
      };
      await write("orphan-stale", "x");
      await write("live-fresh", "y");
      const putRecord = (rec) =>
        new Promise((res, rej) => {
          const req = indexedDB.open("rivulet-transfers", 1);
          req.onupgradeneeded = () => {
            if (!req.result.objectStoreNames.contains("transfers"))
              req.result.createObjectStore("transfers", { keyPath: "id" });
          };
          req.onsuccess = () => {
            const tx = req.result.transaction("transfers", "readwrite");
            tx.objectStore("transfers").put(rec);
            tx.oncomplete = () => res();
            tx.onerror = () => rej(tx.error);
          };
          req.onerror = () => rej(req.error);
        });
      // A crash > 60s ago: in-progress but stale.
      await putRecord({ id: "orphan-stale", status: "in-progress", updatedAt: Date.now() - 120000 });
      // Another tab writing right now: in-progress and fresh — must survive.
      await putRecord({ id: "live-fresh", status: "in-progress", updatedAt: Date.now() });
    });

    // Reload runs the startup sweep (main.tsx).
    await sweeper.reload();
    await sweeper.waitForTimeout(2000);
    const remaining = await sweeper.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const out = [];
      // @ts-ignore
      for await (const name of root.keys()) out.push(name);
      return out;
    });
    check("stale orphan swept on startup", !remaining.includes("orphan-stale"), remaining.join(","));
    check("fresh live file kept (multi-tab safety)", remaining.includes("live-fresh"), remaining.join(","));
  } finally {
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }

  console.log(`\n${failures === 0 ? "ALL OPFS TESTS PASSED" : failures + " FAILED"}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("TEST ERROR:", e);
  process.exit(1);
});
