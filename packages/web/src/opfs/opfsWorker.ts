// Dedicated worker that writes an incoming file straight to OPFS.
//
// createSyncAccessHandle() is only available inside a Worker (never on the main
// thread), and its synchronous write() is the fast, well-supported path — the
// async FileSystemWritableFileStream is slower and patchier across exactly the
// Safari/Firefox versions this feature targets. So all writes happen here.
//
// Writes go to an EXPLICIT offset (write(data, { at })), not append: resume
// after a reconnect can deliver chunks out of order, and offset-addressed
// writes keep the file correct regardless of arrival order.
import type { ToOpfsWorker, FromOpfsWorker } from "./opfsMessages";

// Minimal shape of the OPFS sync access handle (not in the DOM lib yet).
interface SyncAccessHandle {
  write(buffer: ArrayBufferView | ArrayBuffer, options?: { at?: number }): number;
  flush(): void;
  close(): void;
  getSize(): number;
}

// `self` inside a worker is the worker global; typing it as Worker gives us
// postMessage(msg, transfer) + onmessage without pulling in the WebWorker lib
// (which conflicts with the DOM lib the rest of the app compiles against).
const ctx = self as unknown as Worker;

let handle: SyncAccessHandle | null = null;
let fileId = "";

function post(msg: FromOpfsWorker): void {
  ctx.postMessage(msg);
}

ctx.onmessage = async (event: MessageEvent<ToOpfsWorker>) => {
  const msg = event.data;
  try {
    switch (msg.type) {
      case "init": {
        fileId = msg.id;
        const root = await navigator.storage.getDirectory();
        const fh = await root.getFileHandle(fileId, { create: true });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        handle = (await (fh as any).createSyncAccessHandle()) as SyncAccessHandle;
        post({ type: "ready" });
        break;
      }
      case "chunk": {
        if (!handle) throw new Error("write before init");
        handle.write(new Uint8Array(msg.data), { at: msg.at });
        post({ type: "ok", reqId: msg.reqId });
        break;
      }
      case "finalize": {
        if (!handle) throw new Error("finalize before init");
        handle.flush();
        const size = handle.getSize();
        handle.close();
        handle = null;
        post({ type: "ok", reqId: msg.reqId, size });
        break;
      }
      case "abort": {
        try {
          handle?.close();
        } catch {
          /* already closed */
        }
        handle = null;
        try {
          const root = await navigator.storage.getDirectory();
          await root.removeEntry(fileId);
        } catch {
          /* file may not exist */
        }
        post({ type: "ok", reqId: msg.reqId });
        break;
      }
    }
  } catch (err) {
    const reqId = "reqId" in msg ? msg.reqId : null;
    post({ type: "error", reqId, error: err instanceof Error ? err.message : String(err) });
  }
};
