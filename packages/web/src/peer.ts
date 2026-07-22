import type {
  ClientToServerMessage,
  ServerToClientMessage,
  CallFailureReason,
} from "@p2p/shared";
import {
  FileReceiver,
  sendFile as sendFileOverChannel,
  sendFolder as sendFolderOverChannel,
  type IncomingFile,
  type IncomingFolder,
  type FolderEntry,
  type FolderStart,
  type FolderProgress,
  type SendStart,
  type SendProgress,
  type ReceiveProgress,
} from "./fileTransfer";
import { getIceServers } from "./iceConfig";

const DEFAULT_SIGNALING_URL = import.meta.env.VITE_SIGNALING_URL ?? "ws://localhost:8080";

type SignalPayload =
  | { kind: "sdp"; description: RTCSessionDescriptionInit }
  | { kind: "candidate"; candidate: RTCIceCandidateInit };

export class PeerConnection {
  private ws: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private receiver = new FileReceiver();
  // Signals can race the local RTCPeerConnection's own creation (e.g. an ICE
  // candidate arriving before 'ready' has been processed) — queue and flush.
  private pendingSignals: SignalPayload[] = [];

  onConnected: () => void = () => {};
  onDisconnected: (reason?: string) => void = () => {};
  onIncomingFile: (file: IncomingFile) => void = () => {};
  onIncomingFolder: (folder: IncomingFolder) => void = () => {};
  onSendStart: (start: SendStart) => void = () => {};
  onSendProgress: (progress: SendProgress) => void = () => {};
  onReceiveProgress: (progress: ReceiveProgress) => void = () => {};
  onFolderStart: (start: FolderStart, direction: "send" | "receive") => void = () => {};
  onFolderProgress: (progress: FolderProgress, direction: "send" | "receive") => void = () => {};
  onError: (message: string) => void = () => {};
  onAuthed: (userId: string) => void = () => {};
  onCallFailed: (reason: CallFailureReason) => void = () => {};
  onPresenceSnapshot: (online: string[]) => void = () => {};
  onPresenceUpdate: (userId: string, online: boolean) => void = () => {};

  constructor(private signalingUrl: string = DEFAULT_SIGNALING_URL) {
    this.receiver.onFile = (file) => this.onIncomingFile(file);
    this.receiver.onProgress = (progress) => this.onReceiveProgress(progress);
    this.receiver.onFolderStart = (s) => this.onFolderStart(s, "receive");
    this.receiver.onFolderProgress = (p) => this.onFolderProgress(p, "receive");
    this.receiver.onFolder = (folder) => this.onIncomingFolder(folder);
  }

  createRoom(): Promise<string> {
    return new Promise((resolve, reject) => {
      const ws = this.connectSignaling();
      const onMessage = (event: MessageEvent) => {
        const message = JSON.parse(event.data) as ServerToClientMessage;
        if (message.type === "created") {
          ws.removeEventListener("message", onMessage);
          resolve(message.code);
        } else if (message.type === "error") {
          ws.removeEventListener("message", onMessage);
          reject(new Error(message.message));
        }
      };
      ws.addEventListener("message", onMessage);
      ws.addEventListener("open", () => this.send({ type: "create" }));
      ws.addEventListener("error", () => reject(new Error("Signaling connection failed")));
    });
  }

  joinRoom(code: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = this.connectSignaling();
      const onMessage = (event: MessageEvent) => {
        const message = JSON.parse(event.data) as ServerToClientMessage;
        if (message.type === "ready") {
          ws.removeEventListener("message", onMessage);
          resolve();
        } else if (message.type === "error") {
          ws.removeEventListener("message", onMessage);
          reject(new Error(message.message));
        }
      };
      ws.addEventListener("message", onMessage);
      ws.addEventListener("open", () => this.send({ type: "join", code }));
      ws.addEventListener("error", () => reject(new Error("Signaling connection failed")));
    });
  }

  // --- Authenticated, persistent presence connection (contact-based flow) ---

  // Opens a long-lived signaling socket, authenticates it (registering presence)
  // and resolves with the user's id. The socket stays open to receive incoming
  // calls and to place outgoing ones.
  connectAuthenticated(token: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const ws = this.connectSignaling();
      const onMessage = (event: MessageEvent) => {
        const message = JSON.parse(event.data) as ServerToClientMessage;
        if (message.type === "authed") {
          ws.removeEventListener("message", onMessage);
          resolve(message.userId);
        } else if (message.type === "error") {
          ws.removeEventListener("message", onMessage);
          reject(new Error(message.message));
        }
      };
      ws.addEventListener("message", onMessage);
      const doAuth = () => this.send({ type: "auth", token });
      if (ws.readyState === WebSocket.OPEN) doAuth();
      else ws.addEventListener("open", doAuth);
      ws.addEventListener("error", () => reject(new Error("Signaling connection failed")));
    });
  }

  // Places a codeless call to an online mutual contact. The resulting `ready`
  // (or `call-failed`) arrives via the persistent socket's message handler.
  callContact(targetUserId: string): void {
    this.send({ type: "call", targetUserId });
  }

  async sendFile(file: File): Promise<void> {
    if (!this.channel || this.channel.readyState !== "open") {
      throw new Error("No open peer connection to send over");
    }
    await sendFileOverChannel(
      this.channel,
      file,
      (progress) => this.onSendProgress(progress),
      (start) => this.onSendStart(start),
    );
  }

  async sendFolder(folderName: string, entries: FolderEntry[]): Promise<void> {
    if (!this.channel || this.channel.readyState !== "open") {
      throw new Error("No open peer connection to send over");
    }
    await sendFolderOverChannel(
      this.channel,
      folderName,
      entries,
      (progress) => this.onFolderProgress(progress, "send"),
      (start) => this.onFolderStart(start, "send"),
    );
  }

  close(): void {
    this.channel?.close();
    this.pc?.close();
    this.ws?.close();
  }

  private connectSignaling(): WebSocket {
    const ws = new WebSocket(this.signalingUrl);
    this.ws = ws;
    ws.addEventListener("message", (event) => this.handleSignalingMessage(event));
    return ws;
  }

  private send(message: ClientToServerMessage): void {
    this.ws?.send(JSON.stringify(message));
  }

  private handleSignalingMessage(event: MessageEvent): void {
    const message = JSON.parse(event.data) as ServerToClientMessage;
    switch (message.type) {
      case "ready":
        this.setupPeerConnection(message.initiator);
        break;
      case "signal":
        this.handleSignal(message.payload as SignalPayload);
        break;
      case "peer-left":
        this.onDisconnected("peer_left");
        break;
      case "authed":
        this.onAuthed(message.userId);
        break;
      case "call-failed":
        this.onCallFailed(message.reason);
        break;
      case "presence-snapshot":
        this.onPresenceSnapshot(message.online);
        break;
      case "presence-update":
        this.onPresenceUpdate(message.userId, message.online);
        break;
      case "error":
        this.onError(message.message);
        break;
    }
  }

  private setupPeerConnection(initiator: boolean): void {
    // Tear down any previous peer connection so the persistent socket can host
    // sequential calls without leaking RTCPeerConnections.
    this.channel?.close();
    this.pc?.close();
    this.channel = null;
    this.pendingSignals = [];

    const pc = new RTCPeerConnection({ iceServers: getIceServers() });
    this.pc = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.send({
          type: "signal",
          payload: { kind: "candidate", candidate: event.candidate.toJSON() } satisfies SignalPayload,
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") {
        this.onDisconnected("connection_failed");
      } else if (pc.connectionState === "closed") {
        this.onDisconnected("connection_closed");
      }
    };

    if (initiator) {
      this.setupDataChannel(pc.createDataChannel("file-transfer"));
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => {
          this.send({
            type: "signal",
            payload: { kind: "sdp", description: pc.localDescription! } satisfies SignalPayload,
          });
        })
        .catch((err) => this.onError(String(err)));
    } else {
      pc.ondatachannel = (event) => this.setupDataChannel(event.channel);
    }

    const queued = this.pendingSignals;
    this.pendingSignals = [];
    for (const payload of queued) void this.applySignal(payload);
  }

  private setupDataChannel(channel: RTCDataChannel): void {
    this.channel = channel;
    channel.binaryType = "arraybuffer";
    channel.onopen = () => this.onConnected();
    channel.onclose = () => this.onDisconnected("channel_closed");
    channel.onmessage = (event) => this.receiver.handleMessage(event.data);
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
      if (payload.kind === "sdp") {
        await pc.setRemoteDescription(payload.description);
        if (payload.description.type === "offer") {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          this.send({
            type: "signal",
            payload: { kind: "sdp", description: pc.localDescription! } satisfies SignalPayload,
          });
        }
      } else {
        await pc.addIceCandidate(payload.candidate);
      }
    } catch (err) {
      this.onError(String(err));
    }
  }
}
