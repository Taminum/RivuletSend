// Part 2 (resumable transfers), over a real WebRTC data channel between two
// pages. Headless Chromium can't be network-partitioned reliably, so instead of
// a real ICE restart the test drives the exact same resume code paths through
// dev-only hooks on the peer:
//
//  A. Recovery: catch a transfer mid-flight, abort the send (as a drop would),
//     then have the receiver request resume — the sender re-seeks and the file
//     completes byte-exact (sha256).
//  B. Failure: force the grace window to expire and confirm the transfer is
//     marked connection_lost rather than hanging forever.
//
// The literal "kill wifi → ICE restart" recovery is the manual validation step.
import { chromium } from "playwright";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomBytes } from "node:crypto";

const WEB = process.env.WEB || "http://localhost:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dir = mkdtempSync(join(tmpdir(), "rivulet-resume-"));

function makeFixture(name, size) {
  const bytes = randomBytes(size);
  const p = join(dir, name);
  writeFileSync(p, bytes);
  return { path: p, hash: createHash("sha256").update(bytes).digest("hex") };
}

async function startTransfer(sender, receiver, fixturePath) {
  await sender.locator('input[type="file"]:not([webkitdirectory])').setInputFiles(fixturePath);
  const code = (await sender.locator(".share-code.big").textContent({ timeout: 10000 })).trim();
  await receiver.getByRole("button", { name: "Receive", exact: true }).click();
  await receiver.locator(".code-input").fill(code);
  await receiver.getByRole("button", { name: "Connect" }).click();
}

// Poll the receiver until a file is partway through (0 < received < total).
async function waitForMidFlight(receiver) {
  for (let i = 0; i < 400; i++) {
    const snap = await receiver.evaluate(() => window.__peer?._testReceiveProgress?.() ?? []);
    const f = snap.find((x) => x.received > 0 && x.received < x.total);
    if (f) return f;
    await sleep(15);
  }
  return null;
}

async function main() {
  const browser = await chromium.launch({ args: ["--disable-features=WebRtcHideLocalIpsWithMdns"] });
  let failures = 0;
  const check = (n, ok, extra = "") => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${n}${extra ? " — " + extra : ""}`);
    if (!ok) failures++;
  };

  try {
    // --- A. Recovery ---
    {
      const big = makeFixture("resume.bin", 64 * 1024 * 1024);
      const ctx = await browser.newContext();
      const sender = await ctx.newPage();
      const receiver = await ctx.newPage();
      await sender.goto(WEB);
      await receiver.goto(WEB);
      await startTransfer(sender, receiver, big.path);

      const mid = await waitForMidFlight(receiver);
      check("caught the transfer mid-flight", !!mid && mid.received < mid.total, mid ? `${mid.received}/${mid.total}` : "missed");

      // Interrupt the send, then trigger resume from the receiver.
      await sender.evaluate(() => window.__peer?._testAbortSend?.());
      await sleep(200);
      await receiver.evaluate(() => window.__peer?._testRequestResume?.());

      const dl = receiver.locator('a.file-action[download="resume.bin"]');
      await dl.waitFor({ timeout: 40000 });
      const [download] = await Promise.all([receiver.waitForEvent("download"), dl.click()]);
      const got = createHash("sha256").update(readFileSync(await download.path())).digest("hex");
      check("file completes byte-exact after interrupt + resume", got === big.hash);

      await ctx.close();
    }

    // --- B. Failure past the grace window ---
    {
      const big = makeFixture("fail.bin", 64 * 1024 * 1024);
      const ctx = await browser.newContext();
      const sender = await ctx.newPage();
      const receiver = await ctx.newPage();
      await sender.goto(WEB);
      await receiver.goto(WEB);
      await startTransfer(sender, receiver, big.path);

      const mid = await waitForMidFlight(receiver);
      check("failure case: caught mid-flight", !!mid, mid ? `${mid.received}/${mid.total}` : "missed");

      const reason = await receiver.evaluate(async () => {
        const p = window.__peer;
        return await new Promise((resolve) => {
          const orig = p.onDisconnected;
          p.onDisconnected = (r) => {
            orig?.(r);
            resolve(r);
          };
          p._testForceFail();
        });
      });
      check("grace-expiry marks the transfer connection_lost", reason === "connection_lost", String(reason));

      // And it must NOT then complete.
      const completed = await receiver
        .locator('a.file-action[download="fail.bin"]')
        .waitFor({ timeout: 2500 })
        .then(() => true)
        .catch(() => false);
      check("failed transfer does not complete", completed === false);

      await ctx.close();
    }
  } finally {
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }

  console.log(`\n${failures === 0 ? "ALL RECONNECT-RESUME TESTS PASSED" : failures + " FAILED"}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("TEST ERROR:", e);
  process.exit(1);
});
