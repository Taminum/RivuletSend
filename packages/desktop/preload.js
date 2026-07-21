// Exposes a small, safe native API to the web app's renderer. The web detects
// window.rivulet to unlock native folder handling; everything else is unchanged.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("rivulet", {
  isDesktop: true,
  pickSaveDir: () => ipcRenderer.invoke("pick-save-dir"),
  writeFolderFile: (arg) => ipcRenderer.invoke("write-folder-file", arg),
  pickFolder: () => ipcRenderer.invoke("pick-folder"),
  readFile: (fullPath) => ipcRenderer.invoke("read-file", fullPath),
  notify: (arg) => ipcRenderer.invoke("notify", arg),
});
