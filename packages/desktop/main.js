// Rivulet desktop shell. Electron's renderer is Chromium, so the whole web app
// (WebRTC, signaling, accounts, contacts, history, folders) runs inside a
// BrowserWindow unmodified. On top of that we expose native folder IPC so the
// receiver can write a real folder tree to disk — no File System Access API
// limits, no zip fallback.
const { app, BrowserWindow, ipcMain, dialog, Notification, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

// Point at the hosted/dev web app for now (fastest). Bundling packages/web's
// build for offline shell is a later step (needs the API to allow this origin).
const APP_URL = process.env.RIVULET_URL || "http://localhost:5173";

function createWindow() {
  const win = new BrowserWindow({
    width: 1120,
    height: 780,
    backgroundColor: "#0a0d0c",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.removeMenu();
  win.loadURL(APP_URL);
  return win;
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
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
