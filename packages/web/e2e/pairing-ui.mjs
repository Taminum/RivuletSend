// Full pairing UX across two browser contexts (separate cookie jars):
//  - "fresh" device: Settings -> sign-in -> "Link this device with a code",
//    shows a code, and becomes logged in once approved — no password typed.
//  - "approver" (Alice, already signed in): Settings -> Paired devices ->
//    "Link a new device" -> enter code -> confirm -> approve.
// Then removing the device from the approver logs the fresh one out.
//
// Prereqs: api (8081, with pairing), web (5173), Postgres.
import { chromium } from "playwright";

const WEB = "http://localhost:5173";
const API = "http://localhost:8081";

async function gotoSettings(page) {
  await page.goto(WEB);
  await page.locator(".nav-item", { hasText: "Settings" }).click();
}

async function main() {
  const browser = await chromium.launch();
  let failures = 0;
  const check = (n, ok, extra = "") => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${n}${extra ? " — " + extra : ""}`);
    if (!ok) failures++;
  };

  try {
    // Approver already has a session (Alice, via password).
    const approverCtx = await browser.newContext();
    await approverCtx.request.post(`${API}/auth/login`, {
      data: { email: "alice@example.com", password: "hunter2pass" },
    });
    const approver = await approverCtx.newPage();
    await gotoSettings(approver);
    const seesPanel = await approver
      .getByText("Paired devices")
      .waitFor({ timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    check("approver sees Paired devices", seesPanel);

    // Fresh device: no session.
    const freshCtx = await browser.newContext();
    const fresh = await freshCtx.newPage();
    await gotoSettings(fresh);
    await fresh.getByRole("button", { name: /Link this device with a code/ }).click();
    await fresh.locator(".share-code").first().waitFor({ timeout: 10000 });
    const code = (await fresh.locator(".share-code").first().textContent())?.trim() ?? "";
    check("fresh device shows a 6-digit code", /^\d{6}$/.test(code), code);

    // Approver links the new device by its code.
    await approver.getByRole("button", { name: /Link a new device/ }).click();
    await approver.locator(".code-input").fill(code);
    await approver.getByRole("button", { name: /^Continue$/ }).click();
    // Confirmation shows what's being approved.
    await approver.getByRole("button", { name: /Approve & link/ }).waitFor({ timeout: 10000 });
    check("approver sees a confirmation before approving", true);
    await approver.getByRole("button", { name: /Approve & link/ }).click();

    // Fresh device becomes signed in by polling — verify via a real session
    // check, retried until the poll lands (no password ever typed here).
    let sessionOk = false;
    let account = null;
    for (let i = 0; i < 15 && !sessionOk; i++) {
      const me = await freshCtx.request.get(`${API}/auth/me`);
      if (me.ok()) {
        sessionOk = true;
        account = (await me.json())?.user?.displayName;
      } else {
        await fresh.waitForTimeout(1000);
      }
    }
    check("fresh device is logged in with no password", sessionOk);
    check("session is Alice's account", account === "Alice");
    // The sign-in/link screen is gone once logged in.
    check(
      "sign-in screen replaced by the account",
      !(await fresh.getByRole("button", { name: /Link this device with a code/ }).isVisible().catch(() => false)),
    );

    // Approver's device list now includes it (browser reports platform "web").
    await approver.reload();
    await approver.locator(".nav-item", { hasText: "Settings" }).click();
    const deviceRow = approver
      .locator(".file-row")
      .filter({ has: approver.locator(".file-name", { hasText: "New device" }) });
    const listed = await deviceRow
      .first()
      .waitFor({ timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    check("new device appears in the approver's list", listed);

    // Remove it -> the fresh device's next request is rejected immediately.
    await deviceRow.first().getByRole("button", { name: "Remove" }).click();
    await approver.waitForTimeout(700);
    const afterRevoke = await freshCtx.request.get(`${API}/auth/me`);
    check("removed device is rejected on next request", afterRevoke.status() === 401, String(afterRevoke.status()));
  } finally {
    await browser.close();
  }

  console.log(`\n${failures === 0 ? "ALL PAIRING-UI TESTS PASSED" : failures + " FAILED"}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("TEST ERROR:", e);
  process.exit(1);
});
