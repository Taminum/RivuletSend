// Let a received file be dragged out of the app straight into an OS folder (or
// the desktop). Uses Chromium's "DownloadURL" drag protocol — supported in
// Chrome/Edge and the Electron desktop shell; a no-op elsewhere.
export function onFileDragStart(
  e: React.DragEvent,
  file: { url?: string; name: string; mimeType?: string },
): void {
  if (!file.url) return;
  const mime = file.mimeType || "application/octet-stream";
  const href = new URL(file.url, window.location.href).href;
  try {
    e.dataTransfer.setData("DownloadURL", `${mime}:${file.name}:${href}`);
    e.dataTransfer.effectAllowed = "copy";
  } catch {
    /* older browsers: drag-out just won't start */
  }
}
