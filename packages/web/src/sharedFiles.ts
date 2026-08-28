// Reads the file(s) the service worker stashed when another app shared to
// OwlSend (Web Share Target), so the Send view can stage them for a transfer.
const SHARE_CACHE = "owlsend-shared";

export async function consumeSharedFiles(): Promise<File[]> {
  try {
    if (typeof caches === "undefined") return [];
    const cache = await caches.open(SHARE_CACHE);
    const keys = await cache.keys();
    const files: File[] = [];
    for (const req of keys) {
      const res = await cache.match(req);
      if (res) {
        const blob = await res.blob();
        const name = new URL(req.url).searchParams.get("name") || "shared";
        files.push(new File([blob], name, { type: blob.type || "application/octet-stream" }));
      }
      await cache.delete(req);
    }
    return files;
  } catch {
    return [];
  }
}
