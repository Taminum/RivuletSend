import type {
  ClientToServerMessage,
  ServerToClientMessage,
  CallFailureReason,
} from '@p2p/shared';
import {SIGNALING_URL} from './session';
import {api} from './api';

// The signaling/presence WebSocket. One socket carries both presence (who of my
// devices/contacts is online) AND the per-call SDP/ICE signaling once the server
// pairs two sockets. Mirrors packages/web/src/presence/PresenceContext.tsx, minus
// the send-when-online queue (that's a later milestone).

export type PresenceEvents = {
  onStatus?: (online: boolean) => void;
  onDevicesChanged?: (online: Set<string>) => void;
  onContactsChanged?: (online: Set<string>) => void;
  // A peer relationship was established (we called, or we were called). initiator
  // tells us whether to create the offer. Start a transfer peer bound to this.
  onReady?: (initiator: boolean) => void;
  // SDP/ICE from the paired peer — hand to the active transfer peer.
  onSignal?: (payload: unknown) => void;
  onPeerLeft?: () => void;
  onCallFailed?: (reason: CallFailureReason) => void;
};

export class Presence {
  private ws: WebSocket | null = null;
  private closedByUs = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private backoff = 1000;

  onlineDevices = new Set<string>();
  onlineContacts = new Set<string>();

  constructor(private events: PresenceEvents) {}

  async connect(): Promise<void> {
    this.closedByUs = false;
    let token: string;
    try {
      token = (await api.wsToken()).token;
    } catch {
      this.scheduleReconnect();
      return;
    }
    const ws = new WebSocket(SIGNALING_URL);
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.backoff = 1000;
      this.send({type: 'auth', token});
    });
    ws.addEventListener('message', (event: any) => this.handle(event.data as string));
    ws.addEventListener('close', () => {
      this.events.onStatus?.(false);
      if (!this.closedByUs) this.scheduleReconnect();
    });
    ws.addEventListener('error', () => {
      // 'close' follows; reconnect is handled there.
    });
  }

  private scheduleReconnect(): void {
    if (this.closedByUs || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, this.backoff);
    this.backoff = Math.min(this.backoff * 2, 15000);
  }

  private handle(raw: string): void {
    let m: ServerToClientMessage;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    switch (m.type) {
      case 'authed':
        this.events.onStatus?.(true);
        break;
      case 'my-devices-snapshot':
        this.onlineDevices = new Set(m.online);
        this.events.onDevicesChanged?.(this.onlineDevices);
        break;
      case 'my-device-update':
        if (m.online) this.onlineDevices.add(m.deviceId);
        else this.onlineDevices.delete(m.deviceId);
        this.events.onDevicesChanged?.(new Set(this.onlineDevices));
        break;
      case 'presence-snapshot':
        this.onlineContacts = new Set(m.online);
        this.events.onContactsChanged?.(this.onlineContacts);
        break;
      case 'presence-update':
        if (m.online) this.onlineContacts.add(m.userId);
        else this.onlineContacts.delete(m.userId);
        this.events.onContactsChanged?.(new Set(this.onlineContacts));
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
      case 'call-failed':
        this.events.onCallFailed?.(m.reason);
        break;
      case 'error':
        // Bad token etc. — drop and let reconnect refresh it.
        break;
    }
  }

  send(message: ClientToServerMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  callDevice(deviceId: string): void {
    this.send({type: 'call-device', targetDeviceId: deviceId});
  }

  callContact(userId: string): void {
    this.send({type: 'call', targetUserId: userId});
  }

  close(): void {
    this.closedByUs = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }
}
