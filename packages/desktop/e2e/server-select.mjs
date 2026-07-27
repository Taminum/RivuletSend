// The desktop shell lets you point it at your own server. This covers the full
// selection flow: the setup screen shows on first launch, a valid address is
// verified and loaded, the choice persists to the next launch, and — the
// security-relevant part — a remote page cannot switch the server out from
// under the user.
//
// A throwaway HTTP server plays the role of "your RivuletSend server": it just
// answers /api/health and serves a page with a known marker.
import { _electron as electron } from "playwright";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const desktopDir = fileURLToPath(new URL("..", import.meta.url));

function startFakeServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === "/api/health") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }
      res.setHeader("content-type", "text/html");
      res.end('<!doctype html><html><body><div id="fake-app">FAKE SERVER</div></body></html>');
    });
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

async function main() {
  let failures = 0;
  const check = (n, ok, extra = "") => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${n}${extra ? " — " + extra : ""}`);
    if (!ok) failures++;
  };

  const { server, url } = await startFakeServer();
  const userData = mkdtempSync(join(tmpdir(), "rivulet-srv-"));
  const launch = () =>
    electron.launch({ args: [join(desktopDir, "main.js"), `--user-data-dir=${userData}`] });

  try {
    // --- First launch: no server configured -> setup screen ---
    let app = await launch();
    let win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");
    check("setup screen shows when no server is configured", (await win.locator("#url").count()) === 1);

    // Enter the address and connect. The window should navigate to the server.
    await win.locator("#url").fill(url);
    await win.locator("#connect").click();
    await win.locator("#fake-app").waitFor({ timeout: 10000 });
    check("connects to the entered server", (await win.locator("#fake-app").textContent()) === "FAKE SERVER");

    // Security: the now-loaded remote page must not be able to redirect the
    // shell to another server.
    const guard = await win.evaluate(() => window.rivulet.server.set("http://attacker.example"));
    check("a remote page cannot switch the server", guard && guard.ok === false, JSON.stringify(guard));
    check("remote set did not navigate away", (await win.locator("#fake-app").count()) === 1);

    await app.close();

    // --- Second launch: the saved server loads directly, no setup screen ---
    app = await launch();
    win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");
    await win.locator("#fake-app").waitFor({ timeout: 10000 });
    check("saved server loads directly on next launch", (await win.locator("#url").count()) === 0);

    // Switching server (as the menu does) returns to the setup screen, prefilled.
    await win.evaluate(() => window.rivulet.server.get()).then((saved) =>
      check("saved url is the normalized origin", saved === url, saved),
    );

    await app.close();

    // --- A bad address is reported, not silently accepted ---
    const bad = await (async () => {
      const a = await launch();
      const w = await a.firstWindow();
      await w.waitForLoadState("domcontentloaded");
      // It loads the saved (good) server; drive the test IPC directly.
      const r = await w.evaluate(() => window.rivulet.server.test("http://127.0.0.1:1"));
      await a.close();
      return r;
    })();
    check("an unreachable address fails the check", bad && bad.ok === false, JSON.stringify(bad));
  } finally {
    server.close();
    rmSync(userData, { recursive: true, force: true });
  }

  console.log(`\n${failures === 0 ? "ALL SERVER-SELECT TESTS PASSED" : failures + " FAILED"}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("TEST ERROR:", e);
  process.exit(1);
});
