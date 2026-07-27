// Main-thread wrapper around the OPFS worker. Spawns one worker per incoming
// large file, hands chunks over as transferable ArrayBuffers, and exposes
// writeChunk/finalize/abort as promises resolved by worker round-trips.
//
// The finished file is disk-backed: getFile() returns a File that streams from
// OPFS, so building a download from it is not a large in-memory allocation —
// that growing in-memory array was the OOM this whole path exists to avoid.
import { CHUNK_SIZE } from "@p2p/shared";
import type { ToOpfsWorker, FromOpfsWorker } from "./opfsMessages";
import { markInProgress, markCompleted, markAborted, removeRecord, touch } from "./transferStore";

const HEARTBEAT_MS = 5_000;

// Available only where OPFS + workers exist. createSyncAccessHandle itself is
// worker-only and can't be probed from here, but every engine that ships
// navigator.storage.getDirectory also ships it in workers.
export function isOpfsSupported(): boolean {
  return (
    typeof Worker !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.storage &&
    typeof navigator.storage.getDirectory === "function"
  );
}

export class NotEnoughSpaceError extends Error {
  constructor(needed: number, available: number) {
    super(`not enough local storage space (need ${needed} bytes, ~${available} free)`);
    this.name = "NotEnoughSpaceError";
  }
}

export class OpfsWriter {
  private worker: Worker;
  private nextReqId = 1;
  private pending = new Map<number, { resolve: (v: { size?: number }) => void; reject: (e: Error) => void }>();
  private readyResolve: (() => void) | null = null;
  private readyReject: ((e: Error) => void) | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private done = false;

  private constructor(readonly id: string) {
    this.worker = new Worker(new URL("./opfsWorker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (event: MessageEvent<FromOpfsWorker>) => this.onMessage(event.data);
    this.worker.onerror = (e) => this.failAll(new Error(e.message || "opfs worker error"));
  }

  // Reject up front if the incoming transfer can't fit, rather than starting and
  // failing partway through.
  static async create(id: string, declaredSize: number): Promise<OpfsWriter> {
    const { quota, usage } = await navigator.storage.estimate();
    if (typeof quota === "number" && typeof usage === "number") {
      const free = quota - usage;
      if (free < declaredSize) throw new NotEnoughSpaceError(declaredSize, free);
    }
    const w = new OpfsWriter(id);
    await w.init();
    await markInProgress(id);
    w.heartbeat = setInterval(() => void touch(id), HEARTBEAT_MS);
    return w;
  }

  private init(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
      this.postMessage({ type: "init", id: this.id });
    });
  }

  writeChunk(seq: number, data: ArrayBuffer): Promise<void> {
    return this.request((reqId) => ({ type: "chunk", reqId, at: seq * CHUNK_SIZE, data }), [data]).then(
      () => undefined,
    );
  }

  async finalize(): Promise<number> {
    const { size } = await this.request((reqId) => ({ type: "finalize", reqId }));
    this.stopHeartbeat();
    this.done = true;
    await markCompleted(this.id); // the startup sweep deletes it later
    return size ?? 0;
  }

  // Disk-backed File for the completed transfer. Caller turns it into a download.
  async getFile(mimeType: string): Promise<File> {
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle(this.id);
    const file = await fh.getFile();
    return new File([file], this.id, { type: mimeType });
  }

  async abort(): Promise<void> {
    this.stopHeartbeat();
    this.done = true;
    try {
      await this.request((reqId) => ({ type: "abort", reqId }));
    } catch {
      /* best effort */
    }
    await markAborted(this.id).catch(() => {});
    await removeRecord(this.id).catch(() => {});
    this.worker.terminate();
  }

  close(): void {
    this.stopHeartbeat();
    this.worker.terminate();
  }

  // --- internals ---

  private request(
    build: (reqId: number) => ToOpfsWorker,
    transfer: Transferable[] = [],
  ): Promise<{ size?: number }> {
    const reqId = this.nextReqId++;
    return new Promise((resolve, reject) => {
      this.pending.set(reqId, { resolve, reject });
      this.postMessage(build(reqId), transfer);
    });
  }

  private postMessage(msg: ToOpfsWorker, transfer: Transferable[] = []): void {
    this.worker.postMessage(msg, transfer);
  }

  private onMessage(msg: FromOpfsWorker): void {
    if (msg.type === "ready") {
      this.readyResolve?.();
      this.readyResolve = this.readyReject = null;
      return;
    }
    if (msg.type === "ok") {
      this.pending.get(msg.reqId)?.resolve({ size: msg.size });
      this.pending.delete(msg.reqId);
      return;
    }
    // error
    if (msg.reqId != null) {
      this.pending.get(msg.reqId)?.reject(new Error(msg.error));
      this.pending.delete(msg.reqId);
    } else {
      this.failAll(new Error(msg.error));
    }
  }

  private failAll(err: Error): void {
    this.readyReject?.(err);
    this.readyResolve = this.readyReject = null;
    for (const { reject } of this.pending.values()) reject(err);
    this.pending.clear();
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }
}
