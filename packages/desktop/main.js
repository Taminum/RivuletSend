// Rivulet desktop shell. Electron's renderer is Chromium, so the whole web app
// (WebRTC, signaling, accounts, contacts, history, folders) runs inside a
// BrowserWindow unmodified. On top of that we expose native folder IPC so the
// receiver can write a real folder tree to disk — no File System Access API
// limits, no zip fallback.
const { app, BrowserWindow, ipcMain, dialog, Notification, shell, Menu } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

let mainWindow = null;

// --- Which server to load ---
//
// The desktop app is a thin Chromium shell: it loads the web app straight from
// a RivuletSend server, and that server's own bundle already knows its API and
// signaling URLs. So all the user has to choose is one thing — the address of
// their server. It's stored here and can be changed from the menu later.
//
// RIVULET_URL overrides everything, for development and the e2e tests.

function serverConfigPath() {
  return path.join(app.getPath("userData"), "server.json");
}

function readServerUrl() {
  try {
    const parsed = JSON.parse(fs.readFileSync(serverConfigPath(), "utf8"));
    return typeof parsed.url === "string" && parsed.url ? parsed.url : null;
  } catch {
    return null;
  }
}

function writeServerUrl(url) {
  fs.writeFileSync(serverConfigPath(), JSON.stringify({ url }, null, 2));
}

// Turn user input into a bare origin: assume https when no scheme is given,
// drop any path/trailing slash. Returns null if it isn't a valid http(s) URL.
function normalizeServerUrl(input) {
  let s = String(input || "").trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

// Confirm an address is actually a RivuletSend server before committing to it,
// so a typo lands on a clear message instead of a blank window.
async function testServer(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(`${url}/api/health`, { signal: controller.signal });
    if (!res.ok) return { ok: false, error: `Server responded with ${res.status}.` };
    const body = await res.json().catch(() => null);
    if (!body || body.status !== "ok") {
      return { ok: false, error: "That address answered, but it isn't a RivuletSend server." };
    }
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e && e.name === "AbortError" ? "Timed out reaching the server." : "Could not reach that address.",
    };
  } finally {
    clearTimeout(timer);
  }
}

function loadSetup(win) {
  win.loadFile(path.join(__dirname, "setup.html"));
}

// Pick what to show on launch: env override, then a saved server, else setup.
function loadStart(win) {
  const override = process.env.RIVULET_URL;
  if (override) return win.loadURL(override);
  const saved = readServerUrl();
  if (saved) return win.loadURL(saved);
  loadSetup(win);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1120,
    height: 780,
    backgroundColor: "#121214",
    autoHideMenuBar: true, // clean chrome; press Alt for the menu
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow = win;
  loadStart(win);
  return win;
}

function buildMenu() {
  const template = [
    {
      label: "RivuletSend",
      submenu: [
        {
          label: "Switch server…",
          accelerator: "CmdOrCtrl+Shift+O",
          click: () => mainWindow && loadSetup(mainWindow),
        },
        { label: "Reload", accelerator: "CmdOrCtrl+R", click: () => mainWindow && mainWindow.reload() },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    // Clipboard shortcuts, so the address field and the app support copy/paste.
    { role: "editMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// --- Server selection IPC (used by setup.html) ---

ipcMain.handle("server:get", () => readServerUrl());

ipcMain.handle("server:test", async (_event, url) => {
  const normalized = normalizeServerUrl(url);
  if (!normalized) return { ok: false, error: "That doesn't look like a valid address." };
  return { ...(await testServer(normalized)), url: normalized };
});

ipcMain.handle("server:set", (event, url) => {
  // Only the local setup page may redirect the shell. Without this guard a
  // compromised remote page could silently point the app at an attacker's
  // server and phish the next sign-in.
  const from = event.senderFrame && event.senderFrame.url ? event.senderFrame.url : "";
  if (!from.startsWith("file://")) return { ok: false, error: "not_allowed" };
  const normalized = normalizeServerUrl(url);
  if (!normalized) return { ok: false, error: "invalid" };
  writeServerUrl(normalized);
  if (mainWindow) mainWindow.loadURL(normalized);
  return { ok: true, url: normalized };
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// --- Auto-save config (desktop-local, NOT synced to the account: someone may
// want auto-save on their home PC but not on a shared work machine) ---

function configPath() {
  return path.join(app.getPath("userData"), "autosave.json");
}

function defaultConfig() {
  return { enabled: false, dir: path.join(app.getPath("downloads"), "RivuletSend") };
}

function readConfig() {
  try {
    const raw = fs.readFileSync(configPath(), "utf8");
    const parsed = JSON.parse(raw);
    return {
      enabled: Boolean(parsed.enabled),
      dir: typeof parsed.dir === "string" && parsed.dir ? parsed.dir : defaultConfig().dir,
    };
  } catch {
    return defaultConfig();
  }
}

function writeConfig(config) {
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));
}

// Never overwrite: "file.txt" -> "file (1).txt" -> "file (2).txt" ...
function uniquePath(dir, name) {
  const ext = path.extname(name);
  const stem = path.basename(name, ext);
  let candidate = path.join(dir, name);
  let n = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${stem} (${n})${ext}`);
    n += 1;
  }
  return candidate;
}

ipcMain.handle("autosave:get", () => readConfig());

ipcMain.handle("autosave:set", (_event, patch) => {
  const next = { ...readConfig(), ...(patch ?? {}) };
  writeConfig(next);
  return next;
});

// Pick the auto-save folder; persists it and returns the updated config.
ipcMain.handle("autosave:pick-dir", async () => {
  const res = await dialog.showOpenDialog({
    properties: ["openDirectory", "createDirectory"],
    defaultPath: readConfig().dir,
  });
  if (res.canceled || !res.filePaths[0]) return readConfig();
  const next = { ...readConfig(), dir: res.filePaths[0] };
  writeConfig(next);
  return next;
});

// Save an incoming file, but only when auto-save is on AND it came from a
// contact — one-time-code transfers still get the manual prompt in the renderer,
// since a code can end up in more hands than a contact relationship implies.
ipcMain.handle("autosave:save-file", async (_event, { name, bytes, fromContact }) => {
  const config = readConfig();
  if (!config.enabled || !fromContact) return { saved: false };
  await fs.promises.mkdir(config.dir, { recursive: true });
  const safeName = path.basename(name || "file"); // strip any path components
  const target = uniquePath(config.dir, safeName);
  await fs.promises.writeFile(target, Buffer.from(bytes));

  if (Notification.isSupported()) {
    const note = new Notification({ title: "Saved", body: path.basename(target) });
    // Windows Notification has no action buttons; clicking the toast opens the
    // folder. macOS also shows a "Show" action.
    note.on("click", () => shell.showItemInFolder(target));
    note.show();
  }
  return { saved: true, path: target };
});

// Never overwrite a folder either: "MyFolder" -> "MyFolder (1)" ...
function uniqueDir(parent, name) {
  let candidate = path.join(parent, name);
  let n = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(parent, `${name} (${n})`);
    n += 1;
  }
  return candidate;
}

// Auto-save a whole received folder tree, same gating as single files.
ipcMain.handle("autosave:save-folder", async (_event, { folderName, files, fromContact }) => {
  const config = readConfig();
  if (!config.enabled || !fromContact) return { saved: false };
  await fs.promises.mkdir(config.dir, { recursive: true });
  const safeName = path.basename(folderName || "folder");
  const root = uniqueDir(config.dir, safeName);

  for (const f of files) {
    // relativePath is like "MyFolder/sub/a.txt"; drop the leading folder segment
    // so files land under our (possibly de-duplicated) root.
    const parts = String(f.relativePath).split("/").filter(Boolean);
    const rel = parts[0] === safeName ? parts.slice(1).join("/") : parts.join("/");
    const target = path.resolve(root, rel);
    if (!target.startsWith(path.resolve(root))) continue; // guard traversal
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(target, Buffer.from(f.bytes));
  }

  if (Notification.isSupported()) {
    const note = new Notification({ title: "Saved folder", body: `${path.basename(root)} (${files.length} files)` });
    note.on("click", () => shell.showItemInFolder(root));
    note.show();
  }
  return { saved: true, path: root };
});

ipcMain.handle("autosave:show-in-folder", (_event, fullPath) => {
  if (typeof fullPath === "string" && fullPath) shell.showItemInFolder(fullPath);
});

// --- Native folder IPC ---

// Choose a destination directory to save a received folder into.
ipcMain.handle("pick-save-dir", async () => {
  const res = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
  return res.canceled ? null : (res.filePaths[0] ?? null);
});

// Write one received file's bytes to destRoot/relativePath, creating dirs as needed.
ipcMain.handle("write-folder-file", async (_event, { destRoot, relativePath, bytes }) => {
  const target = path.join(destRoot, relativePath);
  // Guard against path traversal in a malicious relativePath.
  const resolved = path.resolve(target);
  if (!resolved.startsWith(path.resolve(destRoot))) throw new Error("invalid path");
  await fs.promises.mkdir(path.dirname(resolved), { recursive: true });
  await fs.promises.writeFile(resolved, Buffer.from(bytes));
  return true;
});

// Choose a folder to send; returns its file entries (relative paths + sizes + full paths).
ipcMain.handle("pick-folder", async () => {
  const res = await dialog.showOpenDialog({ properties: ["openDirectory"] });
  if (res.canceled || !res.filePaths[0]) return null;
  const root = res.filePaths[0];
  const folderName = path.basename(root);
  const entries = [];
  walk(root, folderName, entries);
  return { folderName, entries };
});

// Read a picked file's bytes (for native sending).
ipcMain.handle("read-file", async (_event, fullPath) => {
  return fs.promises.readFile(fullPath);
});

// This machine's name, used as the default label when pairing this device.
ipcMain.handle("device-name", () => {
  const host = os.hostname();
  return { name: host || "Windows PC", platform: process.platform };
});

// Native notification (used on transfer complete).
ipcMain.handle("notify", (_event, { title, body }) => {
  if (Notification.isSupported()) new Notification({ title, body }).show();
});

function walk(dir, prefix, out) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    const rel = `${prefix}/${name}`;
    if (stat.isDirectory()) walk(full, rel, out);
    else if (stat.isFile()) out.push({ relativePath: rel, fullPath: full, size: stat.size });
  }
}
