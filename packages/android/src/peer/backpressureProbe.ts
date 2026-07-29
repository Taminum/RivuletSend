import type {ClientToServerMessage, ServerToClientMessage} from '@p2p/shared';
import {CHUNK_SIZE} from '@p2p/shared';
import {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  type RNDataChannel,
} from '../rtc/webrtc';

// Mirrors the web app's backpressure tuning (packages/web/src/fileTransfer.ts)
// so this measures the SAME strategy the real transfer uses, just with dummy
// payload. If these thresholds behave differently on react-native-webrtc than in
// the browser, that's the finding the plan wants surfaced before anything else
// is built on top of the assumption they don't.
const HIGH_WATER_MARK = 4 * 1024 * 1024;
const LOW_WATER_MARK = 1 * 1024 * 1024;

// If 'bufferedamountlow' never fires within this window while we're above the
// low-water mark, the event is unreliable on this platform — we record that and
// fall back to polling, rather than hanging the probe forever.
const DRAIN_EVENT_TIMEOUT_MS = 2000;

type SignalPayload =
  | {kind: 'sdp'; description: RTCSessionDescriptionInit}
  | {kind: 'candidate'; candidate: RTCIceCandidateInit};

export interface ProbeStats {
  bytes: number;
  seconds: number;
  throughputMBs: number;
  maxBufferedAmount: number;
  drainWaits: number; // times we paused because the buffer was full
  drainEventTimeouts: number; // times 'bufferedamountlow' failed to fire in time
  bufferedAmountLowSupported: boolean;
}

// A minimal, self-contained WebRTC harness for Step 1: establish a data channel
// through the existing signaling server and push a fixed amount of dummy data
// with the real watermark-gated send loop, reporting throughput and — crucially
// — whether the browser-tuned backpressure signals actually work here.
export class BackpressureProbe {
  private ws: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  private channel: RNDataChannel | null = null;
  private pendingSignals: SignalPayload[] = [];
  private initiator = false;

  onStatus: (msg: string) => void = () => {};
  onConnected: (role: 'sender' | 'receiver') => void = () => {};
  onReceiveProgress: (bytes: number, mbps: number) => void = () => {};

  constructor(private signalingUrl: string) {}

  createRoom(): Promise<string> {
    return new Promise((resolve, reject) => {
      const ws = this.connect();
      const onMessage = (event: MessageEvent) => {
        const m = JSON.parse(event.data as string) as ServerToClientMessage;
        if (m.type === 'created') {
          ws.removeEventListener('message', onMessage);
          resolve(m.code);
        } else if (m.type === 'error') {
          ws.removeEventListener('message', onMessage);
          reject(new Error(m.message));
        }
      };
      ws.addEventListener('message', onMessage as EventListener);
      ws.addEventListener('open', () => this.send({type: 'create', burnAfterRead: false}));
      ws.addEventListener('error', () => reject(new Error('signaling connection failed')));
    });
  }

  joinRoom(code: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = this.connect();
      const onMessage = (event: MessageEvent) => {
        const m = JSON.parse(event.data as string) as ServerToClientMessage;
        if (m.type === 'ready') {
          ws.removeEventListener('message', onMessage);
          resolve();
        } else if (m.type === 'error') {
          ws.removeEventListener('message', onMessage);
          reject(new Error(m.message));
        }
      };
      ws.addEventListener('message', onMessage as EventListener);
      ws.addEventListener('open', () => this.send({type: 'join', code}));
      ws.addEventListener('error', () => reject(new Error('signaling connection failed')));
    });
  }

  private connect(): WebSocket {
    const ws = new WebSocket(this.signalingUrl);
    this.ws = ws;
    ws.addEventListener('message', (event) => this.handleSignaling(event as MessageEvent));
    return ws;
  }

  private send(message: ClientToServerMessage): void {
    this.ws?.send(JSON.stringify(message));
  }

  private handleSignaling(event: MessageEvent): void {
    const m = JSON.parse(event.data as string) as ServerToClientMessage;
    switch (m.type) {
      case 'ready':
        this.setupPeerConnection(m.initiator);
        break;
      case 'signal':
        this.handleSignal(m.payload as SignalPayload);
        break;
      case 'peer-left':
        this.onStatus('peer left');
        break;
      case 'error':
        this.onStatus(`error: ${m.message}`);
        break;
    }
  }

  private setupPeerConnection(initiator: boolean): void {
    const pc = new RTCPeerConnection({
      iceServers: [{urls: 'stun:stun.l.google.com:19302'}],
    });
    this.pc = pc;
    this.initiator = initiator;

    pc.addEventListener('icecandidate', (event: any) => {
      if (event.candidate) {
        this.send({
          type: 'signal',
          payload: {kind: 'candidate', candidate: event.candidate},
        });
      }
    });

    if (initiator) {
      this.setupDataChannel(pc.createDataChannel('probe'));
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() =>
          this.send({type: 'signal', payload: {kind: 'sdp', description: pc.localDescription!}}),
        )
        .catch((err) => this.onStatus(String(err)));
    } else {
      pc.addEventListener('datachannel', (event: any) => this.setupDataChannel(event.channel));
    }

    const queued = this.pendingSignals;
    this.pendingSignals = [];
    for (const p of queued) void this.applySignal(p);
  }

  private setupDataChannel(channel: RNDataChannel): void {
    this.channel = channel;
    channel.binaryType = 'arraybuffer';
    channel.addEventListener('open', () =>
      this.onConnected(this.initiator ? 'sender' : 'receiver'),
    );
    if (!this.initiator) {
      let received = 0;
      const start = Date.now();
      channel.addEventListener('message', (event: any) => {
        const data = event.data;
        received += typeof data === 'string' ? data.length : data.byteLength;
        const secs = (Date.now() - start) / 1000;
        this.onReceiveProgress(received, secs > 0 ? received / 1e6 / secs : 0);
      });
    }
  }

  private handleSignal(payload: SignalPayload): void {
    if (!this.pc) {
      this.pendingSignals.push(payload);
      return;
    }
    void this.applySignal(payload);
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
          this.send({type: 'signal', payload: {kind: 'sdp', description: pc.localDescription!}});
        }
      } else {
        await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
      }
    } catch (err) {
      this.onStatus(String(err));
    }
  }

  // Push `totalBytes` of dummy data through the channel with the same
  // watermark-gated loop the real transfer uses, and report how the backpressure
  // signals behaved. Sender role only.
  async runProbe(
    totalBytes: number,
    onProgress: (sent: number) => void,
  ): Promise<ProbeStats> {
    const channel = this.channel;
    if (!channel || channel.readyState !== 'open') {
      throw new Error('no open data channel');
    }
    channel.bufferedAmountLowThreshold = LOW_WATER_MARK;
    const chunk = new ArrayBuffer(CHUNK_SIZE);

    let sent = 0;
    let drainWaits = 0;
    let drainEventTimeouts = 0;
    let maxBuffered = 0;
    let sawLowEvent = false;
    const start = Date.now();

    while (sent < totalBytes) {
      if (channel.bufferedAmount > maxBuffered) maxBuffered = channel.bufferedAmount;

      if (channel.bufferedAmount > HIGH_WATER_MARK) {
        drainWaits++;
        const viaEvent = await this.waitForDrain(channel);
        if (viaEvent) sawLowEvent = true;
        else drainEventTimeouts++;
        continue;
      }

      channel.send(chunk);
      sent += CHUNK_SIZE;
      if (sent % (CHUNK_SIZE * 64) === 0) onProgress(sent);
    }
    onProgress(sent);

    const seconds = (Date.now() - start) / 1000;
    return {
      bytes: sent,
      seconds,
      throughputMBs: seconds > 0 ? sent / 1e6 / seconds : 0,
      maxBufferedAmount: maxBuffered,
      drainWaits,
      drainEventTimeouts,
      bufferedAmountLowSupported: sawLowEvent,
    };
  }

  // Resolves true if 'bufferedamountlow' fired, false if we had to fall back to
  // a timeout+poll (i.e. the event is unreliable here — the key thing to learn).
  private waitForDrain(channel: RNDataChannel): Promise<boolean> {
    if (channel.bufferedAmount <= HIGH_WATER_MARK) return Promise.resolve(true);
    return new Promise((resolve) => {
      let done = false;
      const onLow = () => {
        if (done) return;
        done = true;
        channel.removeEventListener('bufferedamountlow', onLow);
        resolve(true);
      };
      channel.addEventListener('bufferedamountlow', onLow);
      // Fallback: if the event never comes, poll until the buffer drains anyway.
      const poll = setInterval(() => {
        if (done) {
          clearInterval(poll);
          return;
        }
        if (channel.bufferedAmount <= LOW_WATER_MARK) {
          done = true;
          clearInterval(poll);
          channel.removeEventListener('bufferedamountlow', onLow);
          resolve(false);
        }
      }, DRAIN_EVENT_TIMEOUT_MS);
    });
  }

  close(): void {
    this.channel?.close();
    this.pc?.close();
    this.ws?.close();
  }
}
