// Rivulet desktop shell. Electron's renderer is Chromium, so the whole web app
// (WebRTC, signaling, accounts, contacts, history, folders) runs inside a
// BrowserWindow unmodified. On top of that we expose native folder IPC so the
// receiver can write a real folder tree to disk — no File System Access API
// limits, no zip fallback.
const { app, BrowserWindow, ipcMain, dialog, Notification } = require("electron");
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
