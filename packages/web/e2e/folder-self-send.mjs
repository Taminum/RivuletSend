// Folder self-send over the presence channel: pair a device, then send a whole
// folder tree to it from another session of the same account — no code. The
// device receives it as a single collapsed folder transfer, fully.
//
// Prereqs: api (8081), signaling (8080), web (5173), Postgres.
import { chromium } from "playwright";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";

const WEB = "http://localhost:5173";
const API = "http://localhost:8081";

async function main() {
  const browser = await chromium.launch({
    args: ["--disable-features=WebRtcHideLocalIpsWithMdns"],
  });
  let failures = 0;
  const check = (n, ok, extra = "") => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${n}${extra ? " — " + extra : ""}`);
    if (!ok) failures++;
  };

  // A small folder tree on disk to upload.
  const folderDir = mkdtempSync(join(tmpdir(), "rv-folder-"));
  writeFileSync(join(folderDir, "a.txt"), "alpha");
  mkdirSync(join(folderDir, "sub"));
  writeFileSync(join(folderDir, "sub", "b.txt"), "bravo");
  const folderName = basename(folderDir);

  try {
    const senderCtx = await browser.newContext();
    await senderCtx.request.post(`${API}/auth/login`, {
      data: { email: "alice@example.com", password: "hunter2pass" },
    });
    const sender = await senderCtx.newPage();

    // Pair a target device into Alice's account.
    const deviceCtx = await browser.newContext();
    const device = await deviceCtx.newPage();
    await device.goto(WEB);
    await device.locator(".nav-item", { hasText: "Settings" }).click();
    await device.getByRole("button", { name: /Link this device with a code/ }).click();
    await device.locator(".share-code").first().waitFor({ timeout: 10000 });
    const code = (await device.locator(".share-code").first().textContent())?.trim();

    await sender.goto(WEB);
    await sender.locator(".nav-item", { hasText: "Settings" }).click();
    await sender.getByRole("button", { name: /Link a new device/ }).click();
    await sender.locator(".code-input").fill(code);
    await sender.getByRole("button", { name: /^Continue$/ }).click();
    await sender.getByRole("button", { name: /Approve & link/ }).click();

    let paired = false;
    for (let i = 0; i < 15 && !paired; i++) {
      if ((await deviceCtx.request.get(`${API}/auth/me`)).ok()) paired = true;
      else await device.waitForTimeout(1000);
    }
    check("target device paired", paired);
    await device.goto(WEB);

    // Sender opens Send; the device shows online under My devices.
    await sender.goto(WEB);
    const myDevices = sender.locator(".card", { hasText: "My devices" });
    await myDevices.locator(".file-sub.online-tag").first().waitFor({ timeout: 15000 });
    check("device online under My devices", true);

    // Click the folder button on the device's row (sets the target), then hand
    // the folder tree to the resulting file chooser.
    const [chooser] = await Promise.all([
      sender.waitForEvent("filechooser"),
      myDevices.locator(".file-row").first().locator(".icon-btn").first().click(),
    ]);
    await chooser.setFiles(folderDir);

    // The device receives it as one folder row, completed.
    const folderRow = device
      .locator(".global-transfers .file-row")
      .filter({ hasText: `${folderName}/` });
    const got = await folderRow
      .waitFor({ timeout: 45000 })
      .then(() => true)
      .catch(() => false);
    check("device received the folder", got);
    const done = await folderRow
      .locator(".progress-fill.done")
      .waitFor({ timeout: 20000 })
      .then(() => true)
      .catch(() => false);
    check("folder transfer completed", done);
    const sub = (await folderRow.locator(".file-sub").textContent()) ?? "";
    check("all files delivered (2 of 2)", /2 of 2 files/.test(sub), sub.trim());
    // Received folder offers a way to save it.
    check(
      "received folder offers Download .zip",
      await device.getByRole("button", { name: /Download .zip/ }).isVisible(),
    );

    // Cleanup paired device.
    try {
      const { devices } = await (await senderCtx.request.get(`${API}/devices`)).json();
      for (const d of devices) await senderCtx.request.post(`${API}/devices/${d.id}/revoke`);
    } catch {
      /* best-effort */
    }
  } finally {
    await browser.close();
    rmSync(folderDir, { recursive: true, force: true });
  }

  console.log(`\n${failures === 0 ? "ALL FOLDER-SELF-SEND TESTS PASSED" : failures + " FAILED"}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("TEST ERROR:", e);
  process.exit(1);
});
