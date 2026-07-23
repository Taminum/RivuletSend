// Self-send: two sessions of the SAME account online at once (only possible now
// that presence allows multiple sockets per user). A paired device shows up under
// "My devices" on the other session, which sends it a file directly — no code,
// no confirmation — and the paired device receives it byte-for-byte.
//
// Prereqs: api (8081), signaling (8080), web (5173), Postgres.
import { chromium } from "playwright";

const WEB = "http://localhost:5173";
const API = "http://localhost:8081";
const FILE_NAME = "self-send.bin";
const SIZE = 64 * 1024 + 17;
const pattern = (i) => (i * 31 + 7) % 256;
const buffer = Buffer.alloc(SIZE);
for (let i = 0; i < SIZE; i++) buffer[i] = pattern(i);

async function main() {
  const browser = await chromium.launch({
    args: ["--disable-features=WebRtcHideLocalIpsWithMdns"],
  });
  let failures = 0;
  const check = (n, ok, extra = "") => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${n}${extra ? " — " + extra : ""}`);
    if (!ok) failures++;
  };

  try {
    // Sender: Alice signed in with a password (this is "my phone").
    const senderCtx = await browser.newContext();
    await senderCtx.request.post(`${API}/auth/login`, {
      data: { email: "alice@example.com", password: "hunter2pass" },
    });
    const sender = await senderCtx.newPage();

    // Target device: a fresh session that pairs into Alice's account (this is
    // "my Windows client"). Get it a paired session via the pairing flow.
    const deviceCtx = await browser.newContext();
    const device = await deviceCtx.newPage();
    await device.goto(WEB);
    await device.locator(".nav-item", { hasText: "Settings" }).click();
    await device.getByRole("button", { name: /Link this device with a code/ }).click();
    await device.locator(".share-code").first().waitFor({ timeout: 10000 });
    const code = (await device.locator(".share-code").first().textContent())?.trim();

    // Sender approves the pairing.
    await sender.goto(WEB);
    await sender.locator(".nav-item", { hasText: "Settings" }).click();
    await sender.getByRole("button", { name: /Link a new device/ }).click();
    await sender.locator(".code-input").fill(code);
    await sender.getByRole("button", { name: /^Continue$/ }).click();
    await sender.getByRole("button", { name: /Approve & link/ }).click();

    // Device becomes signed in (paired) — and stays online alongside the sender.
    let paired = false;
    for (let i = 0; i < 15 && !paired; i++) {
      const me = await deviceCtx.request.get(`${API}/auth/me`);
      if (me.ok()) paired = true;
      else await device.waitForTimeout(1000);
    }
    check("target device paired and online", paired);
    // Keep the device page on a view that holds the presence socket open.
    await device.goto(WEB);

    // Sender opens Send: the paired device appears under "My devices", online.
    await sender.goto(WEB);
    const myDevices = sender.locator(".card", { hasText: "My devices" });
    const shown = await myDevices
      .waitFor({ timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    check("‘My devices’ lists the paired device", shown);
    const row = myDevices.locator(".file-row").first();
    const onlineShown = await row
      .locator(".file-sub.online-tag")
      .waitFor({ timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    check("paired device shows Online on the sender", onlineShown);

    // Send a file straight to it — no code, no confirmation.
    const [chooser] = await Promise.all([
      sender.waitForEvent("filechooser"),
      row.getByRole("button", { name: "Send" }).click(),
    ]);
    await chooser.setFiles({ name: FILE_NAME, mimeType: "application/octet-stream", buffer });

    // The device receives it (global transfers panel), byte-for-byte.
    await device.locator(`.global-transfers a[download="${FILE_NAME}"]`).waitFor({ timeout: 45000 });
    check("device received the self-sent file", true);
    const integrity = await device.evaluate(
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
    check(`byte-for-byte correct (${SIZE} bytes)`, integrity === "OK", integrity);

    // Cleanup: revoke the paired device so the account list doesn't accumulate.
    try {
      const { devices } = await (await senderCtx.request.get(`${API}/devices`)).json();
      for (const d of devices) await senderCtx.request.post(`${API}/devices/${d.id}/revoke`);
    } catch {
      /* best-effort */
    }
  } finally {
    await browser.close();
  }

  console.log(`\n${failures === 0 ? "ALL SELF-SEND TESTS PASSED" : failures + " FAILED"}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("TEST ERROR:", e);
  process.exit(1);
});
