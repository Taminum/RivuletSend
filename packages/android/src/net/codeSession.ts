import type {ClientToServerMessage, ServerToClientMessage} from '@p2p/shared';
import {SIGNALING_URL} from './session';

// Anonymous, code-based signaling: create a room (get a 6-digit code to share) or
// join one by code. A separate socket from presence — this flow needs no account.
// The paired peer's SDP/ICE rides over the same socket once the room is joined.
// Mirrors the create/join half of packages/web/src/peer.ts.

export interface CodeSessionEvents {
  onCode?: (code: string) => void; // room created, share this code
  onReady?: (initiator: boolean) => void; // peer joined / we joined; start the peer
  onSignal?: (payload: unknown) => void;
  onPeerLeft?: () => void;
  onError?: (message: string) => void;
}

export class CodeSession {
  private ws: WebSocket | null = null;

  constructor(private events: CodeSessionEvents) {}

  private open(onOpen: () => void): void {
    const ws = new WebSocket(SIGNALING_URL);
    this.ws = ws;
    ws.addEventListener('open', onOpen);
    ws.addEventListener('message', (event: any) => this.handle(event.data as string));
    ws.addEventListener('error', () => this.events.onError?.('Connection failed'));
    ws.addEventListener('close', () => this.events.onPeerLeft?.());
  }

  create(): void {
    this.open(() => this.send({type: 'create', burnAfterRead: false}));
  }

  join(code: string): void {
    this.open(() => this.send({type: 'join', code}));
  }

  private handle(raw: string): void {
    let m: ServerToClientMessage;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    switch (m.type) {
      case 'created':
        this.events.onCode?.(m.code);
        break;
      case 'ready':
        this.events.onReady?.(m.initiator);
        break;
      case 'signal':
        this.events.onSignal?.(m.payload);
        break;
      case 'peer-left':
        this.events.onPeerLeft?.();
        break;
      case 'error':
        this.events.onError?.(m.message);
        break;
    }
  }

  send(message: ClientToServerMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  sendSignal(payload: unknown): void {
    this.send({type: 'signal', payload});
  }

  close(): void {
    try {
      this.ws?.close();
    } catch {}
    this.ws = null;
  }
}
