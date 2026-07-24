// Naming: a paired device defaults to the real machine/browser name (not
// "New device"), devices can be renamed, and contacts can be given a private
// nickname that shows everywhere I see them.
//
// Prereqs: api (8081), signaling (8080), web (5173), Postgres.
import { chromium } from "playwright";

const WEB = "http://localhost:5173";
const API = "http://localhost:8081";

async function main() {
  const browser = await chromium.launch();
  let failures = 0;
  const check = (n, ok, extra = "") => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${n}${extra ? " — " + extra : ""}`);
    if (!ok) failures++;
  };

  try {
    const senderCtx = await browser.newContext();
    await senderCtx.request.post(`${API}/auth/login`, {
      data: { email: "alice@example.com", password: "hunter2pass" },
    });
    const sender = await senderCtx.newPage();

    // --- Pair a device; its default label should be the browser/OS name ---
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
    await sender.waitForTimeout(1500);

    const devicesCard = sender.locator(".card", { hasText: "Paired devices" });
    const deviceRow = devicesCard.locator(".file-row").first();
    await deviceRow.waitFor({ timeout: 15000 });
    const autoName = (await deviceRow.locator(".file-name").textContent())?.trim() ?? "";
    check("device got a real default name (not 'New device')", !/New device/.test(autoName), autoName);
    check("default name looks like a browser/OS name", /Chrome|Edge|Firefox|Safari|Windows/i.test(autoName), autoName);

    // --- Rename the device ---
    sender.once("dialog", (d) => d.accept("My Test PC"));
    await deviceRow.getByRole("button", { name: "Rename" }).click();
    await sender.waitForTimeout(1200);
    const renamed = (await devicesCard.locator(".file-row").first().locator(".file-name").textContent()) ?? "";
    check("device rename applied", renamed.includes("My Test PC"), renamed.trim());

    // Persisted server-side, not just in the DOM.
    const { devices } = await (await senderCtx.request.get(`${API}/devices`)).json();
    check("device rename persisted", devices.some((d) => d.label === "My Test PC"));

    // --- Rename a contact (private nickname) ---
    await sender.locator(".nav-item", { hasText: "Contacts" }).click();
    const bobRow = sender
      .locator(".file-row")
      .filter({ has: sender.locator(".file-name", { hasText: /^Bob$/ }) })
      .first();
    await bobRow.waitFor({ timeout: 15000 });
    sender.once("dialog", (d) => d.accept("Bobby Nickname"));
    await bobRow.getByRole("button", { name: "Rename" }).click();
    await sender.waitForTimeout(1200);

    const nicknamed = await sender
      .locator(".file-name", { hasText: "Bobby Nickname" })
      .first()
      .waitFor({ timeout: 10000 })
      .then(() => true)
      .catch(() => false);
    check("contact nickname shows on the Contacts page", nicknamed);

    // It should also show in the Send list.
    await sender.locator(".nav-item", { hasText: "Send" }).click();
    const inSendList = await sender
      .locator(".card", { hasText: "Send to a contact" })
      .locator(".file-name", { hasText: "Bobby Nickname" })
      .first()
      .waitFor({ timeout: 10000 })
      .then(() => true)
      .catch(() => false);
    check("contact nickname shows in the Send list", inSendList);

    // --- Cleanup: clear the nickname and revoke the device ---
    try {
      const contacts = await (await senderCtx.request.get(`${API}/contacts`)).json();
      const bobEntry = contacts.accepted.find((c) => c.user.displayName === "Bob");
      if (bobEntry) {
        await senderCtx.request.patch(`${API}/contacts/${bobEntry.user.id}`, { data: { alias: null } });
      }
      const list = await (await senderCtx.request.get(`${API}/devices`)).json();
      for (const d of list.devices) await senderCtx.request.post(`${API}/devices/${d.id}/revoke`);
    } catch {
      /* best-effort */
    }
  } finally {
    await browser.close();
  }

  console.log(`\n${failures === 0 ? "ALL RENAME TESTS PASSED" : failures + " FAILED"}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("TEST ERROR:", e);
  process.exit(1);
});
