// Startup sweep for orphaned OPFS temp files. This is the normal case OPFS
// receive storage protects against, not an edge case: a tab that crashes
// mid-transfer leaves a partial file behind with nothing to resume it.
//
// A file is an orphan unless its transfer is "currently in-progress" — meaning
// a still-open tab is actively writing it, proven by a fresh heartbeat in the
// IndexedDB store. A crashed transfer's record goes stale; a completed/aborted
// one is terminal; a file with no record at all predates tracking. All get swept.
import { allRecords, removeRecord } from "./transferStore";
import { isOpfsSupported } from "./opfsWriter";

// A live transfer heartbeats every 5s (see OpfsWriter); 60s of silence means the
// writer is gone. Generous enough to survive a stalled-but-alive tab.
const STALE_MS = 60_000;

export async function cleanupOrphanedOpfsFiles(): Promise<number> {
  if (!isOpfsSupported()) return 0;

  let root: FileSystemDirectoryHandle;
  try {
    root = await navigator.storage.getDirectory();
  } catch {
    return 0;
  }

  const records = new Map((await allRecords().catch(() => [])).map((r) => [r.id, r]));
  const now = Date.now();
  let deleted = 0;

  // Async-iterate the directory. keys() isn't in every TS DOM lib yet.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const names: AsyncIterableIterator<string> = (root as any).keys();
  for await (const name of names) {
    const rec = records.get(name);
    const live = rec?.status === "in-progress" && now - rec.updatedAt < STALE_MS;
    if (live) continue;

    try {
      await root.removeEntry(name);
    } catch {
      /* already gone */
    }
    if (rec) await removeRecord(name).catch(() => {});
    deleted++;
  }
  return deleted;
}
