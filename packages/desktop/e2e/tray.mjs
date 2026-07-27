// Background behaviour: closing the window hides it to the tray (so the
// signaling connection in the renderer stays alive and the user keeps receiving
// transfers), reopening works, and only Quit actually exits the process.
//
// RIVULET_URL=about:blank so no server is needed — the tray/close logic is
// independent of page content.
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

  const userData = mkdtempSync(join(tmpdir(), "rivulet-tray-"));
  const app = await electron.launch({
    args: [join(desktopDir, "main.js"), `--user-data-dir=${userData}`],
    env: { ...process.env, RIVULET_URL: "about:blank" },
  });

  try {
    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");

    const visible = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isVisible(),
    );
    check("window is visible on launch", visible === true);

    // Simulate the user closing the window (clicking the X).
    const afterClose = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      w.close();
      return {
        count: BrowserWindow.getAllWindows().length,
        destroyed: w.isDestroyed(),
        visible: w.isDestroyed() ? null : w.isVisible(),
      };
    });
    check("closing keeps the window alive (still online)", afterClose.destroyed === false && afterClose.count === 1);
    check("closing hides it to the background", afterClose.visible === false);

    // Reopen, as the tray's "Open" item / tray click does.
    const reshown = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      w.show();
      return w.isVisible();
    });
    check("window can be reopened from the tray", reshown === true);

    // Quit must actually exit — not hide. If the close handler still blocked
    // during a real quit, the process would never emit 'close' and this times out.
    app.evaluate(({ app }) => app.quit()).catch(() => {});
    const exited = await app
      .waitForEvent("close", { timeout: 6000 })
      .then(() => true)
      .catch(() => false);
    check("Quit exits the app promptly", exited === true);
  } finally {
    try {
      await app.close();
    } catch {}
    rmSync(userData, { recursive: true, force: true });
  }

  console.log(`\n${failures === 0 ? "ALL TRAY TESTS PASSED" : failures + " FAILED"}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("TEST ERROR:", e);
  process.exit(1);
});
