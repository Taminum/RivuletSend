import { CHUNK_SIZE, type DataChannelMessage, type ManifestEntry } from "@p2p/shared";
import { zip } from "fflate";

// Pause sending above this many buffered bytes, resume once the channel drains
// back below the low-water mark. Naive demos that skip this crash the channel
// (or the tab) on anything bigger than a few MB.
const HIGH_WATER_MARK = 4 * 1024 * 1024;
const LOW_WATER_MARK = 1 * 1024 * 1024;

export interface SendProgress {
  id: string;
  sent: number;
  total: number;
}

export interface SendStart {
  id: string;
  name: string;
  size: number;
}

export interface ReceiveProgress {
  id: string;
  received: number;
  total: number;
}

export interface IncomingFile {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  blob: Blob;
}

// --- Folder types ---
export interface FolderEntry {
  relativePath: string;
  file: File;
}

export interface FolderStart {
  folderId: string;
  folderName: string;
  totalFiles: number;
  totalBytes: number;
}

export interface FolderProgress {
  folderId: string;
  filesDone: number;
  totalFiles: number;
  bytesTransferred: number;
  totalBytes: number;
}

export interface IncomingFolder {
  folderId: string;
  folderName: string;
  files: { relativePath: string; blob: Blob }[];
}

// Native API exposed by the Electron shell (preload.js), when running desktop.
export interface AutoSaveConfig {
  enabled: boolean;
  dir: string;
}
interface RivuletNative {
  isDesktop: boolean;
  pickSaveDir: () => Promise<string | null>;
  writeFolderFile: (arg: { destRoot: string; relativePath: string; bytes: Uint8Array }) => Promise<boolean>;
  pickFolder?: () => Promise<{ folderName: string; entries: FolderEntry[] } | null>;
  readFile?: (fullPath: string) => Promise<Uint8Array>;
  // This machine's name, used as the default label when pairing.
  deviceName?: () => Promise<{ name: string; platform: string }>;
  // Auto-save (desktop-local config)
  autoSaveGet?: () => Promise<AutoSaveConfig>;
  autoSaveSet?: (patch: Partial<AutoSaveConfig>) => Promise<AutoSaveConfig>;
  autoSavePickDir?: () => Promise<AutoSaveConfig>;
  autoSaveFile?: (arg: {
    name: string;
    bytes: Uint8Array;
    fromContact: boolean;
  }) => Promise<{ saved: boolean; path?: string }>;
  autoSaveFolder?: (arg: {
    folderName: string;
    files: { relativePath: string; bytes: Uint8Array }[];
    fromContact: boolean;
  }) => Promise<{ saved: boolean; path?: string }>;
  showInFolder?: (fullPath: string) => Promise<void>;
}
declare global {
  interface Window {
    rivulet?: RivuletNative;
  }
}

const isDesktop = typeof window !== "undefined" && Boolean(window.rivulet?.isDesktop);

// Can we write a real folder tree to disk? Native (Electron) or Chromium's FSA.
export const canSaveFolder =
  isDesktop || (typeof window !== "undefined" && "showDirectoryPicker" in window);

function baseName(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

// --- Sending ---
export async function sendFile(
  channel: RTCDataChannel,
  file: File,
  onProgress?: (progress: SendProgress) => void,
  onStart?: (start: SendStart) => void,
): Promise<void> {
  const id = crypto.randomUUID();
  channel.bufferedAmountLowThreshold = LOW_WATER_MARK;

  onStart?.({ id, name: file.name, size: file.size });
  sendControl(channel, {
    type: "file-start",
    id,
    name: file.name,
    size: file.size,
    mimeType: file.type || "application/octet-stream",
  });
  await streamFileBody(channel, id, file, (sent) => onProgress?.({ id, sent, total: file.size }));
  sendControl(channel, { type: "file-end", id });
}

export async function sendFolder(
  channel: RTCDataChannel,
  folderName: string,
  entries: FolderEntry[],
  onProgress?: (p: FolderProgress) => void,
  onStart?: (s: FolderStart) => void,
): Promise<void> {
  channel.bufferedAmountLowThreshold = LOW_WATER_MARK;
  const folderId = crypto.randomUUID();
  const manifest: ManifestEntry[] = entries.map((e) => ({
    id: crypto.randomUUID(),
    relativePath: e.relativePath,
    size: e.file.size,
  }));
  const totalBytes = entries.reduce((sum, e) => sum + e.file.size, 0);

  onStart?.({ folderId, folderName, totalFiles: entries.length, totalBytes });
  sendControl(channel, { type: "manifest", folderName, entries: manifest });

  let bytesTransferred = 0;
  let filesDone = 0;
  for (let i = 0; i < entries.length; i++) {
    const { id, relativePath } = manifest[i];
    const file = entries[i].file;
    sendControl(channel, {
      type: "file-start",
      id,
      name: baseName(relativePath),
      size: file.size,
      mimeType: file.type || "application/octet-stream",
    });
    const before = bytesTransferred;
    await streamFileBody(channel, id, file, (sent) => {
      bytesTransferred = before + sent;
      onProgress?.({ folderId, filesDone, totalFiles: entries.length, bytesTransferred, totalBytes });
    });
    bytesTransferred = before + file.size;
    sendControl(channel, { type: "file-end", id });
    filesDone += 1;
    onProgress?.({ folderId, filesDone, totalFiles: entries.length, bytesTransferred, totalBytes });
  }
}

async function streamFileBody(
  channel: RTCDataChannel,
  id: string,
  file: File,
  onSent: (sent: number) => void,
): Promise<void> {
  let offset = 0;
  let seq = 0;
  while (offset < file.size) {
    await waitForBufferedAmountLow(channel);
    const slice = file.slice(offset, offset + CHUNK_SIZE);
    const buffer = await slice.arrayBuffer();
    sendControl(channel, { type: "chunk", id, seq });
    channel.send(buffer);
    offset += buffer.byteLength;
    seq += 1;
    onSent(offset);
  }
}

function sendControl(channel: RTCDataChannel, message: DataChannelMessage): void {
  channel.send(JSON.stringify(message));
}

function waitForBufferedAmountLow(channel: RTCDataChannel): Promise<void> {
  if (channel.bufferedAmount <= HIGH_WATER_MARK) return Promise.resolve();
  return new Promise((resolve) => {
    const handler = () => {
      channel.removeEventListener("bufferedamountlow", handler);
      resolve();
    };
    channel.addEventListener("bufferedamountlow", handler);
  });
}

// --- Receiving ---
interface InProgressFile {
  name: string;
  size: number;
  mimeType: string;
  chunks: ArrayBuffer[];
  received: number;
}

interface FolderContext {
  folderId: string;
  folderName: string;
  entryById: Map<string, { relativePath: string; size: number }>;
  totalFiles: number;
  totalBytes: number;
  bytesReceived: number;
  filesDone: number;
  blobs: Map<string, Blob>;
}

// Feed every RTCDataChannel message (control JSON strings and binary chunks,
// interleaved in order on an ordered channel) into handleMessage; the control
// message immediately preceding a binary chunk says which file/seq it belongs to.
export class FileReceiver {
  private files = new Map<string, InProgressFile>();
  private pendingChunkFileId: string | null = null;
  private folder: FolderContext | null = null;

  onFile: (file: IncomingFile) => void = () => {};
  onProgress: (progress: ReceiveProgress) => void = () => {};
  onFolderStart: (s: FolderStart) => void = () => {};
  onFolderProgress: (p: FolderProgress) => void = () => {};
  onFolder: (folder: IncomingFolder) => void = () => {};

  handleMessage(data: string | ArrayBuffer): void {
    if (typeof data === "string") {
      this.handleControl(JSON.parse(data) as DataChannelMessage);
    } else {
      this.handleChunk(data);
    }
  }

  private handleControl(message: DataChannelMessage): void {
    switch (message.type) {
      case "manifest": {
        const entryById = new Map(message.entries.map((e) => [e.id, { relativePath: e.relativePath, size: e.size }]));
        this.folder = {
          folderId: crypto.randomUUID(),
          folderName: message.folderName,
          entryById,
          totalFiles: message.entries.length,
          totalBytes: message.entries.reduce((s, e) => s + e.size, 0),
          bytesReceived: 0,
          filesDone: 0,
          blobs: new Map(),
        };
        this.onFolderStart({
          folderId: this.folder.folderId,
          folderName: this.folder.folderName,
          totalFiles: this.folder.totalFiles,
          totalBytes: this.folder.totalBytes,
        });
        break;
      }
      case "file-start":
        this.files.set(message.id, {
          name: message.name,
          size: message.size,
          mimeType: message.mimeType,
          chunks: [],
          received: 0,
        });
        break;
      case "chunk":
        this.pendingChunkFileId = message.id;
        break;
      case "file-end":
        this.finishFile(message.id);
        break;
    }
  }

  private handleChunk(data: ArrayBuffer): void {
    const fileId = this.pendingChunkFileId;
    this.pendingChunkFileId = null;
    if (!fileId) return;

    const file = this.files.get(fileId);
    if (!file) return;

    file.chunks.push(data);
    file.received += data.byteLength;

    if (this.folder && this.folder.entryById.has(fileId)) {
      this.folder.bytesReceived += data.byteLength;
      this.emitFolderProgress();
    } else {
      this.onProgress({ id: fileId, received: file.received, total: file.size });
    }
  }

  private finishFile(id: string): void {
    const file = this.files.get(id);
    if (!file) return;
    this.files.delete(id);
    const blob = new Blob(file.chunks, { type: file.mimeType });

    if (this.folder && this.folder.entryById.has(id)) {
      this.folder.blobs.set(id, blob);
      this.folder.filesDone += 1;
      this.emitFolderProgress();
      if (this.folder.filesDone >= this.folder.totalFiles) {
        this.finishFolder();
      }
      return;
    }

    this.onFile({ id, name: file.name, size: file.size, mimeType: file.mimeType, blob });
  }

  private emitFolderProgress(): void {
    if (!this.folder) return;
    this.onFolderProgress({
      folderId: this.folder.folderId,
      filesDone: this.folder.filesDone,
      totalFiles: this.folder.totalFiles,
      bytesTransferred: this.folder.bytesReceived,
      totalBytes: this.folder.totalBytes,
    });
  }

  private finishFolder(): void {
    const folder = this.folder;
    if (!folder) return;
    this.folder = null;
    // Emit files in manifest order.
    const files: IncomingFolder["files"] = [];
    for (const [id, meta] of folder.entryById) {
      const blob = folder.blobs.get(id);
      if (blob) files.push({ relativePath: meta.relativePath, blob });
    }
    this.onFolder({ folderId: folder.folderId, folderName: folder.folderName, files });
  }
}

// --- Saving a received folder ---

// Write the real folder tree to a directory the user picks. Uses the Electron
// native path when available (no browser limits), else Chromium's FSA. Requires
// a user gesture (call from a click handler).
export async function saveFolderToDisk(folder: IncomingFolder): Promise<void> {
  if (window.rivulet?.isDesktop) {
    const destRoot = await window.rivulet.pickSaveDir();
    if (!destRoot) return;
    for (const f of folder.files) {
      const bytes = new Uint8Array(await f.blob.arrayBuffer());
      await window.rivulet.writeFolderFile({ destRoot, relativePath: f.relativePath, bytes });
    }
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const root: any = await (window as any).showDirectoryPicker();
  for (const f of folder.files) {
    const parts = f.relativePath.split("/").filter(Boolean);
    const fileName = parts.pop()!;
    let dir = root;
    for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
    const handle = await dir.getFileHandle(fileName, { create: true });
    const writable = await handle.createWritable();
    await writable.write(f.blob);
    await writable.close();
  }
}

// Everywhere: zip the folder client-side (preserving relative paths) and download it.
export async function downloadFolderAsZip(folder: IncomingFolder): Promise<void> {
  const entries: Record<string, Uint8Array> = {};
  for (const f of folder.files) {
    entries[f.relativePath] = new Uint8Array(await f.blob.arrayBuffer());
  }
  const data = await new Promise<Uint8Array>((resolve, reject) => {
    zip(entries, { level: 0 }, (err, out) => (err ? reject(err) : resolve(out)));
  });
  const blob = new Blob([data as unknown as BlobPart], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${folder.folderName || "folder"}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
