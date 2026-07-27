// Tiny IndexedDB table tracking the lifecycle of OPFS-backed receives, so the
// startup sweep (opfsCleanup) can tell an orphaned temp file (tab crashed
// mid-transfer) from one another still-open tab is actively writing.
//
// OPFS is shared across all tabs of an origin, so "in-progress" has to be
// visible across tabs and carry a freshness timestamp: a crashed transfer's
// record goes stale (no more heartbeats) while a live one keeps getting touched.

const DB_NAME = "rivulet-transfers";
const STORE = "transfers";
const DB_VERSION = 1;

export type TransferStatus = "in-progress" | "completed" | "aborted";

export interface TransferRecord {
  id: string;
  status: TransferStatus;
  updatedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

function put(record: TransferRecord): Promise<void> {
  return tx("readwrite", (s) => s.put(record)).then(() => undefined);
}

export function markInProgress(id: string): Promise<void> {
  return put({ id, status: "in-progress", updatedAt: Date.now() });
}

// Heartbeat: keeps a long, live transfer from looking stale to another tab's sweep.
export function touch(id: string): Promise<void> {
  return markInProgress(id);
}

export function markCompleted(id: string): Promise<void> {
  return put({ id, status: "completed", updatedAt: Date.now() });
}

export function markAborted(id: string): Promise<void> {
  return put({ id, status: "aborted", updatedAt: Date.now() });
}

export function removeRecord(id: string): Promise<void> {
  return tx("readwrite", (s) => s.delete(id)).then(() => undefined);
}

export function allRecords(): Promise<TransferRecord[]> {
  return tx<TransferRecord[]>("readonly", (s) => s.getAll() as IDBRequest<TransferRecord[]>);
}
