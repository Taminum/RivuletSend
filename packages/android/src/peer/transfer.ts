import ReactNativeBlobUtil from 'react-native-blob-util';
import {CHUNK_SIZE, type DataChannelMessage} from '@p2p/shared';
import type {RNDataChannel} from '../rtc/webrtc';
import type {PickedFile} from '../files/pick';
import {createReceiveSink, type ReceiveSink} from '../files/save';
import {base64ToBytes, bytesToBase64} from '../files/base64';

const fs = ReactNativeBlobUtil.fs;

// Read the file a window at a time (not chunk at a time): one native slice+read
// per 4 MB instead of per 64 KB keeps the disk cost off the hot loop, while the
// channel still sees 64 KB chunks. Aligned to CHUNK_SIZE (64 windows worth).
const READ_WINDOW = 64 * CHUNK_SIZE; // 4 MB

// Same watermarks as the web app (packages/web/src/fileTransfer.ts) — the probe
// confirmed react-native-webrtc honours bufferedAmount / bufferedamountlow, so
// the identical backpressure strategy keeps the channel from drowning.
const HIGH_WATER_MARK = 4 * 1024 * 1024;
const LOW_WATER_MARK = 1 * 1024 * 1024;

function sendControl(channel: RNDataChannel, message: DataChannelMessage): void {
  channel.send(JSON.stringify(message));
}

function waitForDrain(channel: RNDataChannel): Promise<void> {
  if (channel.bufferedAmount <= HIGH_WATER_MARK) return Promise.resolve();
  return new Promise(resolve => {
    const onLow = () => {
      channel.removeEventListener('bufferedamountlow', onLow as any);
      resolve();
    };
    channel.addEventListener('bufferedamountlow', onLow as any);
  });
}

// Stream one file's body over the channel (file-start / chunk / file-end).
async function streamOne(
  channel: RNDataChannel,
  file: PickedFile,
  onSent: (sentInFile: number) => void,
): Promise<void> {
  const id = String(Date.now()) + '-' + Math.random().toString(36).slice(2);
  sendControl(channel, {
    type: 'file-start',
    id,
    name: file.name,
    size: file.size,
    mimeType: file.mimeType || 'application/octet-stream',
  });

  const tmp = `${fs.dirs.CacheDir}/send-${id}.win`;
  let offset = 0;
  let seq = 0;
  try {
    while (offset < file.size) {
      const winEnd = Math.min(offset + READ_WINDOW, file.size);
      await fs.slice(file.path, tmp, offset, winEnd);
      const windowBytes = base64ToBytes(await fs.readFile(tmp, 'base64'));

      let p = 0;
      while (p < windowBytes.byteLength) {
        await waitForDrain(channel);
        const end = Math.min(p + CHUNK_SIZE, windowBytes.byteLength);
        const chunk = windowBytes.subarray(p, end);
        sendControl(channel, {type: 'chunk', id, seq});
        channel.send(chunk.slice().buffer);
        p = end;
        seq += 1;
        onSent(offset + p);
      }
      offset = winEnd;
    }
  } finally {
    await fs.unlink(tmp).catch(() => {});
  }

  sendControl(channel, {type: 'file-end', id});
}

export interface SendProgress {
  filesDone: number;
  totalFiles: number;
  currentName: string;
  sentBytes: number; // across the whole batch
  totalBytes: number;
}

// Send one or more files over the channel, sequentially. Multiple files are just
// back-to-back single-file transfers on the same ordered channel — the receiver
// handles each independently. (Folder trees aren't sent from the phone yet.)
export async function sendFilesOverChannel(
  channel: RNDataChannel,
  files: PickedFile[],
  onProgress: (p: SendProgress) => void,
): Promise<void> {
  channel.bufferedAmountLowThreshold = LOW_WATER_MARK;
  const totalBytes = files.reduce((s, f) => s + f.size, 0);
  let doneBytes = 0;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    await streamOne(channel, file, sentInFile => {
      onProgress({
        filesDone: i,
        totalFiles: files.length,
        currentName: file.name,
        sentBytes: doneBytes + sentInFile,
        totalBytes,
      });
    });
    doneBytes += file.size;
    onProgress({
      filesDone: i + 1,
      totalFiles: files.length,
      currentName: file.name,
      sentBytes: doneBytes,
      totalBytes,
    });
  }
}

// Kept for callers that send exactly one file.
export function sendFileOverChannel(
  channel: RNDataChannel,
  file: PickedFile,
  onProgress: (sent: number, total: number) => void,
): Promise<void> {
  return sendFilesOverChannel(channel, [file], p => onProgress(p.sentBytes, p.totalBytes));
}

export interface IncomingMeta {
  id: string;
  name: string;
  size: number;
  mimeType: string;
}

interface InProgress {
  sink: ReceiveSink;
  meta: IncomingMeta;
  received: number;
  // Set for files that belong to a folder transfer.
  parentFolder?: string;
}

function dirName(relativePath: string): string {
  const parts = relativePath.split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
}

// Consumes datachannel messages and streams incoming files to disk. Handles a
// single file, several files in a row, and folder transfers (a `manifest`
// followed by each file). Encrypted transfers are rejected loudly rather than
// written as ciphertext — RN has no WebCrypto to decrypt them (a later milestone).
export class FileReceiver {
  private current: InProgress | null = null;
  private pendingSeq: number | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  private folder: {name: string; entries: Map<string, string>} | null = null;
  private folderDone = 0;

  onStart: (meta: IncomingMeta) => void = () => {};
  onProgress: (received: number, total: number) => void = () => {};
  onFile: (meta: IncomingMeta, location: string) => void = () => {};
  onFolderStart: (folderName: string, totalFiles: number) => void = () => {};
  onFolderProgress: (filesDone: number, totalFiles: number) => void = () => {};
  onFolderDone: (folderName: string, totalFiles: number) => void = () => {};
  onError: (reason: string) => void = () => {};

  handleMessage(data: string | ArrayBuffer): void {
    if (typeof data === 'string') {
      let msg: DataChannelMessage;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }
      void this.handleControl(msg);
    } else {
      this.handleChunk(data);
    }
  }

  private async handleControl(msg: DataChannelMessage): Promise<void> {
    switch (msg.type) {
      case 'manifest': {
        if (msg.crypto) {
          this.onError('encrypted_unsupported');
          return;
        }
        this.folder = {
          name: msg.folderName || 'folder',
          entries: new Map(msg.entries.map(e => [e.id, e.relativePath])),
        };
        this.folderDone = 0;
        this.onFolderStart(this.folder.name, msg.entries.length);
        break;
      }
      case 'file-start': {
        if (msg.crypto || msg.encName) {
          this.onError('encrypted_unsupported');
          return;
        }
        let sink: ReceiveSink;
        try {
          sink = await createReceiveSink(msg.id);
        } catch {
          this.onError('sink_init_failed');
          return;
        }
        const relativePath = this.folder?.entries.get(msg.id);
        this.current = {
          sink,
          meta: {id: msg.id, name: msg.name, size: msg.size, mimeType: msg.mimeType},
          received: 0,
          parentFolder:
            relativePath !== undefined
              ? [this.folder!.name, dirName(relativePath)].filter(Boolean).join('/')
              : undefined,
        };
        if (this.current.parentFolder === undefined) this.onStart(this.current.meta);
        break;
      }
      case 'chunk':
        this.pendingSeq = msg.seq;
        break;
      case 'file-end':
        this.finish();
        break;
      // resume-* are not handled in this milestone.
    }
  }

  private handleChunk(data: ArrayBuffer): void {
    if (this.pendingSeq === null || !this.current) return;
    this.pendingSeq = null;
    const cur = this.current;
    const bytes = new Uint8Array(data);
    cur.received += bytes.byteLength;
    const b64 = bytesToBase64(bytes);
    this.writeChain = this.writeChain
      .then(() => cur.sink.appendBase64(b64))
      .catch(err => {
        this.onError('write_failed');
        throw err;
      });
    this.writeChain.catch(() => {});
    if (cur.parentFolder === undefined) this.onProgress(cur.received, cur.meta.size);
  }

  private finish(): void {
    const cur = this.current;
    if (!cur) return;
    this.current = null;
    const isFolderFile = cur.parentFolder !== undefined;
    void this.writeChain
      .then(() => cur.sink.finish(cur.meta.name, cur.meta.mimeType, cur.parentFolder ?? ''))
      .then(location => {
        if (isFolderFile) {
          this.folderDone += 1;
          const total = this.folder?.entries.size ?? this.folderDone;
          this.onFolderProgress(this.folderDone, total);
          if (this.folderDone >= total) {
            const name = this.folder?.name ?? 'folder';
            this.folder = null;
            this.onFolderDone(name, total);
          }
        } else {
          this.onFile(cur.meta, location);
        }
      })
      .catch(() => this.onError('write_failed'));
  }

  async abort(): Promise<void> {
    const cur = this.current;
    this.current = null;
    this.folder = null;
    if (cur) await cur.sink.discard();
  }
}
