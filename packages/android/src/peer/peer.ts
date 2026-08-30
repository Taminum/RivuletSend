import {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  type RNDataChannel,
} from '../rtc/webrtc';
import {api, type IceServerConfig} from '../net/api';
import {
  FileReceiver,
  sendFilesOverChannel,
  type IncomingMeta,
  type SendProgress,
} from './transfer';
import type {PickedFile} from '../files/pick';

type SignalPayload =
  | {kind: 'sdp'; description: RTCSessionDescriptionInit}
  | {kind: 'candidate'; candidate: RTCIceCandidateInit};

export interface PeerEvents {
  onConnected?: () => void; // data channel is open, ready to send/receive
  onDisconnected?: () => void; // channel/connection closed
  // Incoming file (this peer is the receiver).
  onIncomingStart?: (meta: IncomingMeta) => void;
  onIncomingProgress?: (received: number, total: number) => void;
  onIncomingFile?: (meta: IncomingMeta, location: string) => void;
  // Incoming folder transfer.
  onIncomingFolderStart?: (folderName: string, totalFiles: number) => void;
  onIncomingFolderProgress?: (filesDone: number, totalFiles: number) => void;
  onIncomingFolderDone?: (folderName: string, totalFiles: number) => void;
  onError?: (reason: string) => void;
}

async function fetchIceServers(): Promise<IceServerConfig[]> {
  try {
    const {iceServers} = await api.turnCredentials();
    if (iceServers?.length) return iceServers;
  } catch {
    /* fall back to public STUN */
  }
  return [{urls: 'stun:stun.l.google.com:19302'}];
}

// One transfer connection: bridges the presence-server signaling to a
// react-native-webrtc data channel and runs the file protocol over it. The same
// shape the web peer uses, so a phone connects to a browser/desktop peer as-is.
export class TransferPeer {
  private pc: RTCPeerConnection | null = null;
  private channel: RNDataChannel | null = null;
  private receiver = new FileReceiver();
  private pendingSignals: SignalPayload[] = [];
  private initiator = false;
  private closed = false;

  constructor(
    private sendSignal: (payload: SignalPayload) => void,
    private events: PeerEvents,
  ) {
    this.receiver.onStart = m => this.events.onIncomingStart?.(m);
    this.receiver.onProgress = (r, t) => this.events.onIncomingProgress?.(r, t);
    this.receiver.onFile = (m, loc) => this.events.onIncomingFile?.(m, loc);
    this.receiver.onFolderStart = (n, t) => this.events.onIncomingFolderStart?.(n, t);
    this.receiver.onFolderProgress = (d, t) => this.events.onIncomingFolderProgress?.(d, t);
    this.receiver.onFolderDone = (n, t) => this.events.onIncomingFolderDone?.(n, t);
    this.receiver.onError = reason => this.events.onError?.(reason);
  }

  async start(initiator: boolean): Promise<void> {
    this.initiator = initiator;
    const iceServers = await fetchIceServers();
    if (this.closed) return;
    const pc = new RTCPeerConnection({iceServers});
    this.pc = pc;

    pc.addEventListener('icecandidate', (event: any) => {
      if (event.candidate) {
        this.sendSignal({kind: 'candidate', candidate: event.candidate.toJSON()});
      }
    });
    pc.addEventListener('connectionstatechange', () => {
      const state = (pc as any).connectionState;
      if (state === 'failed' || state === 'closed' || state === 'disconnected') {
        this.events.onDisconnected?.();
      }
    });

    if (initiator) {
      this.setupChannel(pc.createDataChannel('file-transfer'));
      try {
        const offer = await pc.createOffer({});
        await pc.setLocalDescription(offer);
        this.sendSignal({kind: 'sdp', description: pc.localDescription!});
      } catch (e) {
        this.events.onError?.('offer_failed');
      }
    } else {
      pc.addEventListener('datachannel', (event: any) => this.setupChannel(event.channel));
    }

    const queued = this.pendingSignals;
    this.pendingSignals = [];
    for (const p of queued) void this.applySignal(p);
  }

  private setupChannel(channel: RNDataChannel): void {
    this.channel = channel;
    channel.binaryType = 'arraybuffer';
    channel.addEventListener('open', () => this.events.onConnected?.());
    channel.addEventListener('message', (event: any) =>
      this.receiver.handleMessage(event.data),
    );
    channel.addEventListener('close', () => this.events.onDisconnected?.());
  }

  handleSignal(payload: unknown): void {
    const p = payload as SignalPayload;
    if (!this.pc) {
      this.pendingSignals.push(p);
      return;
    }
    void this.applySignal(p);
  }

  private async applySignal(payload: SignalPayload): Promise<void> {
    const pc = this.pc;
    if (!pc) return;
    try {
      if (payload.kind === 'sdp') {
        await pc.setRemoteDescription(new RTCSessionDescription(payload.description));
        if (payload.description.type === 'offer') {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          this.sendSignal({kind: 'sdp', description: pc.localDescription!});
        }
      } else {
        await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
      }
    } catch (e) {
      this.events.onError?.('signal_failed');
    }
  }

  get connected(): boolean {
    return this.channel?.readyState === 'open';
  }

  async sendFiles(
    files: PickedFile[],
    onProgress: (p: SendProgress) => void,
  ): Promise<void> {
    if (!this.channel || this.channel.readyState !== 'open') {
      throw new Error('channel not open');
    }
    await sendFilesOverChannel(this.channel, files, onProgress);
  }

  close(): void {
    this.closed = true;
    void this.receiver.abort();
    try {
      this.channel?.close();
    } catch {}
    try {
      this.pc?.close();
    } catch {}
    this.channel = null;
    this.pc = null;
  }
}
