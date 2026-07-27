// Message protocol between the main thread (OpfsWriter) and the dedicated
// OPFS worker (opfsWorker). Chunk data crosses as a transferable ArrayBuffer.

export type ToOpfsWorker =
  | { type: "init"; id: string }
  | { type: "chunk"; reqId: number; at: number; data: ArrayBuffer }
  | { type: "finalize"; reqId: number }
  | { type: "abort"; reqId: number };

export type FromOpfsWorker =
  | { type: "ready" }
  | { type: "ok"; reqId: number; size?: number }
  | { type: "error"; reqId: number | null; error: string };
