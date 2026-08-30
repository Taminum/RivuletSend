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

// Stream one picked file over the channel with the file-start / chunk / file-end
// protocol the web + desktop receivers already speak.
export async function sendFileOverChannel(
  channel: RNDataChannel,
  file: PickedFile,
  onProgress: (sent: number, total: number) => void,
): Promise<void> {
  channel.bufferedAmountLowThreshold = LOW_WATER_MARK;
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
      // Materialize this window to a temp file, then read it as base64 in one go.
      await fs.slice(file.path, tmp, offset, winEnd);
      const windowBytes = base64ToBytes(await fs.readFile(tmp, 'base64'));

      let p = 0;
      while (p < windowBytes.byteLength) {
        await waitForDrain(channel);
        const end = Math.min(p + CHUNK_SIZE, windowBytes.byteLength);
        const chunk = windowBytes.subarray(p, end);
        sendControl(channel, {type: 'chunk', id, seq});
        // Copy into a standalone ArrayBuffer so peers receive a binary chunk.
        channel.send(chunk.slice().buffer);
        p = end;
        seq += 1;
        onProgress(offset + p, file.size);
      }
      offset = winEnd;
    }
  } finally {
    await fs.unlink(tmp).catch(() => {});
  }

  sendControl(channel, {type: 'file-end', id});
}

export interface IncomingMeta {
  id: string;
  name: string;
  size: number;
  mimeType: string;
}

// Consumes datachannel messages for an incoming single-file transfer and streams
// the bytes to disk. Folder/encrypted transfers are ignored for now (a later
// milestone) — a manifest message simply isn't handled.
export class FileReceiver {
  private sink: ReceiveSink | null = null;
  private meta: IncomingMeta | null = null;
  private received = 0;
  private pendingSeq: number | null = null;
  // Serialize disk appends so chunks land in order and finish awaits them all.
  private writeChain: Promise<void> = Promise.resolve();

  onStart: (meta: IncomingMeta) => void = () => {};
  onProgress: (received: number, total: number) => void = () => {};
  onFile: (meta: IncomingMeta, location: string) => void = () => {};
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
      case 'file-start': {
        try {
          this.sink = await createReceiveSink(msg.id);
        } catch {
          this.onError('sink_init_failed');
          return;
        }
        this.meta = {id: msg.id, name: msg.name, size: msg.size, mimeType: msg.mimeType};
        this.received = 0;
        this.onStart(this.meta);
        break;
      }
      case 'chunk':
        this.pendingSeq = msg.seq;
        break;
      case 'file-end':
        this.finish();
        break;
      // manifest / resume-* are not handled in this milestone.
    }
  }

  private handleChunk(data: ArrayBuffer): void {
    if (this.pendingSeq === null || !this.sink || !this.meta) return;
    this.pendingSeq = null;
    const sink = this.sink;
    const bytes = new Uint8Array(data);
    this.received += bytes.byteLength;
    const b64 = bytesToBase64(bytes);
    this.writeChain = this.writeChain
      .then(() => sink.appendBase64(b64))
      .catch(err => {
        this.onError('write_failed');
        throw err;
      });
    this.writeChain.catch(() => {});
    this.onProgress(this.received, this.meta.size);
  }

  private finish(): void {
    const sink = this.sink;
    const meta = this.meta;
    if (!sink || !meta) return;
    this.sink = null;
    this.meta = null;
    void this.writeChain
      .then(() => sink.finish(meta.name, meta.mimeType))
      .then(location => this.onFile(meta, location))
      .catch(() => this.onError('write_failed'));
  }

  async abort(): Promise<void> {
    const sink = this.sink;
    this.sink = null;
    this.meta = null;
    if (sink) await sink.discard();
  }
}
