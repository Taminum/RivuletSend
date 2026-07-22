// Auto-save behaviour in the Electron shell. Drives the native bridge the same
// way the renderer does and checks what lands on disk:
//  - contact transfer + toggle on  -> written with no dialog
//  - same name again               -> de-duplicated ("hi (1).txt")
//  - one-time-code transfer         -> NOT auto-saved (still prompts)
//  - toggle off                     -> NOT auto-saved
//  - folder changed mid-session     -> next file uses the new folder, no restart
import { _electron as electron } from "playwright";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const desktopDir = fileURLToPath(new URL("..", import.meta.url));
const bytesOf = (s) => Array.from(new TextEncoder().encode(s));

async function main() {
  let failures = 0;
  const check = (n, ok, extra = "") => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${n}${extra ? " — " + extra : ""}`);
    if (!ok) failures++;
  };

  const userData = mkdtempSync(join(tmpdir(), "rivulet-ud-"));
  const saveDir = mkdtempSync(join(tmpdir(), "rivulet-save-"));
  const saveDir2 = mkdtempSync(join(tmpdir(), "rivulet-save2-"));
  // Isolate the config file so we don't touch the real user's autosave.json.
  const app = await electron.launch({
    args: [join(desktopDir, "main.js"), `--user-data-dir=${userData}`],
  });

  const save = (win, arg) => win.evaluate((a) => window.rivulet.autoSaveFile(a), arg);

  try {
    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");

    // Default is OFF, so a contact file must NOT be saved yet.
    const initial = await win.evaluate(() => window.rivulet.autoSaveGet());
    check("auto-save defaults to off", initial.enabled === false, JSON.stringify(initial));
    const r0 = await save(win, { name: "before.txt", bytes: bytesOf("x"), fromContact: true });
    check("nothing saved while off", r0.saved === false);

    // Turn it on and point it at our temp folder.
    await win.evaluate((dir) => window.rivulet.autoSaveSet({ enabled: true, dir }), saveDir);

    // Contact transfer -> written, no dialog.
    const r1 = await save(win, { name: "hi.txt", bytes: bytesOf("first"), fromContact: true });
    check("contact file auto-saved", r1.saved === true && existsSync(r1.path), JSON.stringify(r1));
    check("saved content correct", r1.path && readFileSync(r1.path, "utf8") === "first");
    check("saved into configured folder", r1.path && r1.path.startsWith(saveDir));

    // Same name again -> de-duplicated, original untouched.
    const r2 = await save(win, { name: "hi.txt", bytes: bytesOf("second"), fromContact: true });
    check("duplicate name de-duplicated", r2.path && r2.path.endsWith("hi (1).txt"), r2.path);
    check("original not overwritten", readFileSync(join(saveDir, "hi.txt"), "utf8") === "first");

    // One-time-code transfer -> still prompts (not auto-saved).
    const r3 = await save(win, { name: "code.txt", bytes: bytesOf("c"), fromContact: false });
    check("one-time-code transfer NOT auto-saved", r3.saved === false);
    check("code file absent from folder", !existsSync(join(saveDir, "code.txt")));

    // Change the folder mid-session -> next file uses it, no restart.
    await win.evaluate((dir) => window.rivulet.autoSaveSet({ dir }), saveDir2);
    const r4 = await save(win, { name: "moved.txt", bytes: bytesOf("m"), fromContact: true });
    check("new folder used mid-session (no restart)", r4.path && r4.path.startsWith(saveDir2), r4.path);

    // Toggle off -> stops saving.
    await win.evaluate(() => window.rivulet.autoSaveSet({ enabled: false }));
    const r5 = await save(win, { name: "after.txt", bytes: bytesOf("a"), fromContact: true });
    check("toggling off stops auto-save", r5.saved === false);
  } finally {
    await app.close();
    for (const d of [userData, saveDir, saveDir2]) rmSync(d, { recursive: true, force: true });
  }

  console.log(`\n${failures === 0 ? "ALL AUTO-SAVE TESTS PASSED" : failures + " FAILED"}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("TEST ERROR:", e);
  process.exit(1);
});
