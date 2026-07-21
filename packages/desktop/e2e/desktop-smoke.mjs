// Smoke test for the Electron shell: launches it, confirms the web app loads
// unmodified, the native API is exposed, and native folder-write works
// (nested path created on disk — the desktop's key upgrade over the web).
import { _electron as electron } from "playwright";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
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

  const app = await electron.launch({ args: [join(desktopDir, "main.js")] });
  const destRoot = mkdtempSync(join(tmpdir(), "rivulet-native-"));
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");
    await win.locator(".brand-name").waitFor({ timeout: 20000 });

    const brand = await win.locator(".brand-name").textContent();
    check("Electron loaded the web app", brand === "RivuletSend", `brand="${brand}"`);

    const isDesktop = await win.evaluate(() => Boolean(window.rivulet && window.rivulet.isDesktop));
    check("native API exposed to renderer (window.rivulet)", isDesktop);

    // Native folder write: renderer -> IPC -> fs, with a nested relativePath and
    // subdirectory creation. destRoot is supplied directly (no dialog needed).
    const bytes = Array.from(new TextEncoder().encode("hello native folder"));
    await win.evaluate(
      async ({ destRoot, bytes }) => {
        await window.rivulet.writeFolderFile({ destRoot, relativePath: "myfolder/sub/deep.txt", bytes });
      },
      { destRoot, bytes },
    );

    const written = join(destRoot, "myfolder", "sub", "deep.txt");
    check("native write created nested file on disk", existsSync(written));
    check(
      "native file content correct",
      existsSync(written) && readFileSync(written, "utf8") === "hello native folder",
    );
  } finally {
    await app.close();
    rmSync(destRoot, { recursive: true, force: true });
  }

  console.log(`\n${failures === 0 ? "ALL DESKTOP SMOKE TESTS PASSED" : failures + " FAILED"}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("TEST ERROR:", e);
  process.exit(1);
});
