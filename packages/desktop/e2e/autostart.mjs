// Start-at-login. The login item launches the app with --hidden so it comes up
// straight in the tray — online in the background, no window in your face. This
// verifies that path, plus that the login-item state reads back as a boolean.
//
// Actually toggling start-at-login writes to the Windows registry, so that is
// left to manual verification rather than mutating the tester's machine here.
import { _electron as electron } from "playwright";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const desktopDir = fileURLToPath(new URL("..", import.meta.url));

async function main() {
  let failures = 0;
  const check = (n, ok, extra = "") => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${n}${extra ? " — " + extra : ""}`);
    if (!ok) failures++;
  };

  const userData = mkdtempSync(join(tmpdir(), "rivulet-autostart-"));
  const app = await electron.launch({
    args: [join(desktopDir, "main.js"), `--user-data-dir=${userData}`, "--hidden"],
    env: { ...process.env, RIVULET_URL: "about:blank" },
  });

  try {
    // The window still gets created (so its renderer connects and the user is
    // online), it's just not shown.
    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");

    const state = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      return { count: BrowserWindow.getAllWindows().length, visible: w.isVisible() };
    });
    check("launched with --hidden creates the window (online in background)", state.count === 1);
    check("launched with --hidden does not show the window", state.visible === false);

    // Can still be surfaced from the tray.
    const shown = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      w.show();
      return w.isVisible();
    });
    check("hidden window can be opened from the tray", shown === true);

    // Read-only: the login-item query returns a usable boolean.
    const loginType = await app.evaluate(
      ({ app }) => typeof app.getLoginItemSettings().openAtLogin,
    );
    check("login-item state reads back as a boolean", loginType === "boolean", loginType);

    app.evaluate(({ app }) => app.quit()).catch(() => {});
    const exited = await app.waitForEvent("close", { timeout: 6000 }).then(() => true).catch(() => false);
    check("Quit exits the app", exited === true);
  } finally {
    try {
      await app.close();
    } catch {}
    rmSync(userData, { recursive: true, force: true });
  }

  console.log(`\n${failures === 0 ? "ALL AUTOSTART TESTS PASSED" : failures + " FAILED"}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("TEST ERROR:", e);
  process.exit(1);
});
