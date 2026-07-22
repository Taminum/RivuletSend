// Per-contact presence: each contact row must show that contact's own online
// state (not the viewer's), update live when they connect/disconnect, and gate
// that row's Send button accordingly.
//
// Alice is the viewer. Bob is online, Carol is not. Then Bob disconnects and
// Carol connects, and Alice's rows must flip without a reload.
//
// Prereqs: api (8081), signaling (8080), web (5173), Postgres running.
import { chromium } from "playwright";

const WEB = "http://localhost:5173";
const API = "http://localhost:8081";
const log = (...a) => console.log(...a);

async function ensureUser(browser, email, password, displayName) {
  const context = await browser.newContext();
  let res = await context.request.post(`${API}/auth/login`, { data: { email, password } });
  if (!res.ok()) {
    res = await context.request.post(`${API}/auth/signup`, { data: { email, password, displayName } });
    if (!res.ok()) throw new Error(`auth failed for ${email}: ${res.status()}`);
  }
  const { user } = await res.json();
  return { context, userId: user.id };
}

// Read the status text + Send-button state of a row in Alice's contact list.
// Rows are identified by display name (the list shows presence, not the email).
function rowFor(page, name) {
  return page
    .locator(".card", { hasText: "Send to a contact" })
    .locator(".file-row")
    .filter({ has: page.locator(".file-name", { hasText: new RegExp(`^${name}$`) }) });
}

async function rowState(page, name) {
  const row = rowFor(page, name);
  const status = (await row.locator(".file-sub").textContent().catch(() => "")) ?? "";
  const disabled = await row.getByRole("button", { name: "Send" }).isDisabled().catch(() => null);
  const dot = await row.locator(".avatar-dot.on").count();
  return { status: status.trim(), sendDisabled: disabled, onlineDot: dot > 0 };
}

async function waitForStatus(page, name, expected, timeout = 15000) {
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    last = await rowState(page, name);
    if (last.status === expected) return last;
    await page.waitForTimeout(300);
  }
  return last;
}

async function main() {
  const browser = await chromium.launch();
  let failures = 0;
  const check = (name, ok, extra = "") => {
    log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
    if (!ok) failures++;
  };

  try {
    const alice = await ensureUser(browser, "alice@example.com", "hunter2pass", "Alice");
    const bob = await ensureUser(browser, "bob2@example.com", "bobpass1234", "Bob");
    const carol = await ensureUser(browser, "carol@example.com", "carolpass123", "Carol");
    for (const [a, b] of [
      [alice, bob],
      [bob, alice],
      [alice, carol],
      [carol, alice],
    ]) {
      await a.context.request.post(`${API}/contacts`, { data: { userId: b.userId } });
    }

    // Bob online first, Carol stays closed.
    const bobPage = await bob.context.newPage();
    await bobPage.goto(WEB);
    await bobPage.locator(".header-status .pulse-line").first().waitFor({ timeout: 20000 });

    const alicePage = await alice.context.newPage();
    await alicePage.goto(WEB);
    await alicePage.locator(".header-status .pulse-line").first().waitFor({ timeout: 20000 });

    // --- Initial snapshot: Bob online, Carol offline ---
    const bobInit = await waitForStatus(alicePage, "Bob", "Online");
    check("Bob shows Online", bobInit.status === "Online", JSON.stringify(bobInit));
    check("Bob has an online dot", bobInit.onlineDot === true);
    check("Bob's Send is enabled", bobInit.sendDisabled === false);

    const carolInit = await rowState(alicePage, "Carol");
    check("Carol shows Offline", carolInit.status === "Offline", JSON.stringify(carolInit));
    check("Carol has no online dot", carolInit.onlineDot === false);
    check("Carol's Send is disabled", carolInit.sendDisabled === true);

    // Distinct per-row states prove this isn't the viewer's own status.
    check(
      "rows differ from each other (per-contact, not self)",
      bobInit.status !== carolInit.status,
    );

    // --- Live update: Bob leaves, Carol arrives ---
    await bobPage.close();
    const carolPage = await carol.context.newPage();
    await carolPage.goto(WEB);
    await carolPage.locator(".header-status .pulse-line").first().waitFor({ timeout: 20000 });

    const bobAfter = await waitForStatus(alicePage, "Bob", "Offline");
    check("Bob flips to Offline live (no reload)", bobAfter.status === "Offline", JSON.stringify(bobAfter));
    check("Bob's Send became disabled", bobAfter.sendDisabled === true);

    const carolAfter = await waitForStatus(alicePage, "Carol", "Online");
    check("Carol flips to Online live (no reload)", carolAfter.status === "Online", JSON.stringify(carolAfter));
    check("Carol's Send became enabled", carolAfter.sendDisabled === false);
  } finally {
    await browser.close();
  }

  log(`\n${failures === 0 ? "ALL CONTACT-PRESENCE TESTS PASSED" : failures + " FAILED"}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("TEST ERROR:", err);
  process.exit(1);
});
