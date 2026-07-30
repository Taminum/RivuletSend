import type {
  ClientToServerMessage,
  ServerToClientMessage,
  CallFailureReason,
  DataChannelMessage,
} from "@p2p/shared";
import { randomSalt, randomNonce, deriveKey, encryptName, toBase64 } from "@p2p/shared";
import {
  FileReceiver,
  sendFolder as sendFolderOverChannel,
  streamFileBody,
  sendControl,
  type StreamCrypto,
  type IncomingFile,
  type IncomingFolder,
  type FolderEntry,
  type FolderStart,
  type FolderProgress,
  type SendStart,
  type SendProgress,
  type ReceiveProgress,
} from "./fileTransfer";
import { getIceServers, primeIceServers } from "./iceConfig";

// Same-origin in production (Caddy proxies /ws); wss:// vs ws:// follows the
// page protocol, so the prebuilt image needs no domain baked in. Overridden by
// VITE_SIGNALING_URL (dev compose); `vite dev` uses the local signaling port.
// `||`, not `??`: an empty (declared-but-unset) build arg inlines "", which `??`
// would keep — `new WebSocket("")` throws. `||` falls through to the origin.
const DEFAULT_SIGNALING_URL =
  import.meta.env.VITE_SIGNALING_URL ||
  (import.meta.env.DEV || typeof window === "undefined"
    ? "ws://localhost:8080"
    : `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`);

// How long a dropped connection may take to recover via ICE restart before the
// transfer is given up as failed. WebRTC uses "disconnected" for a blip that
// may self-heal, so we wait rather than failing on the first sign of trouble.
const GRACE_MS = 30_000;

// Full-reconnect (survive a TOTAL connection loss, not just an ICE blip): when
// ICE-restart on the same connection can't recover it, the original caller
// re-places the call over the still-live presence socket and both sides resume
// from where they left off. Retried with backoff over roughly a two-minute
// window before the transfer is finally declared failed.
const RECONNECT_MAX_ATTEMPTS = 8;
const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_DELAY_MS = 20_000;

// The single-file send currently in flight, so a reconnect can resume it.
interface ActiveSend {
  id: string;
  file: File;
  nextSeq: number;
  aborter: AbortController;
  ackedSeq: number;
  crypto?: StreamCrypto;
  resolve: () => void;
  reject: (err: Error) => void;
}

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
  // Reconnect state (same-session ICE-restart resume).
  private initiator = false;
  private reconnecting = false;
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private activeSend: ActiveSend | null = null;
  // Out-of-band E2EE passphrase. Applies to single-file sends (encrypt) and to
  // receiving an encrypted transfer (decrypt). null = no application-layer
  // encryption (DTLS still applies).
  private passphrase: string | null = null;
  // Full-reconnect state. lastTarget is who to re-call (only the original caller
  // does); fullReconnecting guards the retry loop; closing suppresses reconnect
  // when we're intentionally tearing down.
  private lastTarget: { kind: "device" | "contact"; id: string } | null = null;
  private fullReconnecting = false;
  private fullAttempts = 0;
  private fullTimer: ReturnType<typeof setTimeout> | null = null;
  private closing = false;

  // Set the E2EE passphrase for both roles. Never transmitted anywhere.
  setPassphrase(passphrase: string | null): void {
    this.passphrase = passphrase || null;
    this.receiver.setPassphrase(this.passphrase);
  }

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
  // The authenticated presence socket closed (proxy idle-timeout, network drop,
  // backgrounding). Lets the presence layer reconnect rather than sit on a dead
  // socket that still looks "online".
  onSignalingClosed: () => void = () => {};
  onCallFailed: (reason: CallFailureReason) => void = () => {};
  onPresenceSnapshot: (online: string[]) => void = () => {};
  onPresenceUpdate: (userId: string, online: boolean) => void = () => {};
  onMyDevicesSnapshot: (online: string[]) => void = () => {};
  onMyDeviceUpdate: (deviceId: string, online: boolean) => void = () => {};
  // Fired when the connection drops and while it's trying to recover, and again
  // once it's back — for a "Reconnecting…" indicator.
  onReconnecting: () => void = () => {};
  onReconnected: () => void = () => {};

  constructor(private signalingUrl: string = DEFAULT_SIGNALING_URL) {
    // Start fetching TURN credentials now: by the time a peer connection is
    // actually built (after a full round trip through signaling) they're cached,
    // so getIceServers() can stay synchronous.
    void primeIceServers();
    this.receiver.onFile = (file) => this.onIncomingFile(file);
    this.receiver.onProgress = (progress) => this.onReceiveProgress(progress);
    this.receiver.onFolderStart = (s) => this.onFolderStart(s, "receive");
    this.receiver.onFolderProgress = (p) => this.onFolderProgress(p, "receive");
    this.receiver.onFolder = (folder) => this.onIncomingFolder(folder);
    this.receiver.onError = (_id, reason) => {
      const messages: Record<string, string> = {
        not_enough_space: "Not enough local storage space to receive this file.",
        passphrase_required: "This transfer is encrypted — enter the sender's passphrase to receive it.",
        bad_passphrase: "Incorrect passphrase.",
      };
      this.onError(messages[reason] ?? "Failed to save the received file to disk.");
    };
    // Receiver sends chunk-acks / resume-requests back over the data channel.
    this.receiver.onSendControl = (msg) => this.sendChannelControl(msg);
  }

  createRoom(burnAfterRead = false): Promise<string> {
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
      ws.addEventListener("open", () => this.send({ type: "create", burnAfterRead }));
      ws.addEventListener("error", () => reject(new Error("Signaling connection failed")));
    });
  }

  // Tell signaling the whole transfer finished — invalidates a burn-after-read
  // code for any further joins.
  reportTransferComplete(): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.send({ type: "transfer-complete" });
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
      // Only the presence socket carries this: a close means we've silently gone
      // offline and should reconnect. (Room-flow sockets close normally at end.)
      ws.addEventListener("close", () => this.onSignalingClosed());
    });
  }

  // Places a codeless call to an online mutual contact. The resulting `ready`
  // (or `call-failed`) arrives via the persistent socket's message handler.
  callContact(targetUserId: string): void {
    this.lastTarget = { kind: "contact", id: targetUserId };
    this.send({ type: "call", targetUserId });
  }

  // Codeless call to one of my own online paired devices (self-send).
  callDevice(targetDeviceId: string): void {
    this.lastTarget = { kind: "device", id: targetDeviceId };
    this.send({ type: "call-device", targetDeviceId });
  }

  // Resumable single-file send. Resolves when the file fully arrives (across any
  // reconnects), rejects if the connection is lost past the grace window. When a
  // passphrase is set, the chunks and filename are E2E-encrypted first.
  async sendFile(file: File): Promise<void> {
    if (!this.channel || this.channel.readyState !== "open") {
      throw new Error("No open peer connection to send over");
    }
    const id = crypto.randomUUID();

    let sendCrypto: StreamCrypto | undefined;
    let encName: string | undefined;
    let header: { salt: string; nonce: string } | undefined;
    if (this.passphrase) {
      const salt = randomSalt();
      const nonce = randomNonce();
      const key = await deriveKey(this.passphrase, salt);
      encName = await encryptName(key, file.name, nonce, id);
      header = { salt: toBase64(salt), nonce: toBase64(nonce) };
      sendCrypto = { key, nonce };
    }

    this.onSendStart({ id, name: file.name, size: file.size });
    sendControl(this.channel, {
      type: "file-start",
      id,
      name: sendCrypto ? "" : file.name, // real name travels encrypted in encName
      size: file.size,
      mimeType: file.type || "application/octet-stream",
      encName,
      crypto: header,
    });
    return new Promise<void>((resolve, reject) => {
      this.activeSend = {
        id,
        file,
        nextSeq: 0,
        aborter: new AbortController(),
        ackedSeq: -1,
        crypto: sendCrypto,
        resolve,
        reject,
      };
      void this.pumpSend();
    });
  }

  private async pumpSend(): Promise<void> {
    const s = this.activeSend;
    if (!s || !this.channel) return;
    const result = await streamFileBody(
      this.channel,
      s.id,
      s.file,
      (sent) => this.onSendProgress({ id: s.id, sent, total: s.file.size }),
      { startSeq: s.nextSeq, signal: s.aborter.signal, crypto: s.crypto },
    );
    if (this.activeSend !== s) return; // superseded (failed / replaced)
    if (result.completed) {
      sendControl(this.channel, { type: "file-end", id: s.id });
      this.activeSend = null;
      s.resolve();
    } else {
      // Interrupted by a drop; remember where to pick up and wait for the
      // receiver's resume-request once the connection is back.
      s.nextSeq = result.nextSeq;
    }
  }

  private sendChannelControl(message: DataChannelMessage): void {
    if (this.channel && this.channel.readyState === "open") {
      try {
        sendControl(this.channel, message);
      } catch {
        /* channel closing */
      }
    }
  }

  private onResumeRequest(id: string, fromSeq: number): void {
    const s = this.activeSend;
    if (!s || s.id !== id) {
      this.sendChannelControl({ type: "resume-response", id, accepted: false, fromSeq: 0 });
      return;
    }
    s.nextSeq = fromSeq;
    s.aborter = new AbortController();
    this.sendChannelControl({ type: "resume-response", id, accepted: true, fromSeq });
    void this.pumpSend();
  }

  // --- Reconnect state machine (driven by ICE connection state) ---

  private onConnectionInterrupted(): void {
    if (this.reconnecting) return;
    this.reconnecting = true;
    this.onReconnecting();
    // Stop the in-flight send; the pump remembers nextSeq.
    this.activeSend?.aborter.abort();
    // The original offerer re-offers with restarted ICE; the answerer just waits.
    if (this.initiator && this.pc) {
      const pc = this.pc;
      try {
        pc.restartIce();
        pc.createOffer()
          .then((offer) => pc.setLocalDescription(offer))
          .then(() =>
            this.send({
              type: "signal",
              payload: { kind: "sdp", description: pc.localDescription! } satisfies SignalPayload,
            }),
          )
          .catch(() => {});
      } catch {
        /* ignore */
      }
    }
    this.graceTimer = setTimeout(() => this.onGraceExpired(), GRACE_MS);
  }

  private onConnectionRestored(): void {
    if (!this.reconnecting) return;
    this.reconnecting = false;
    if (this.graceTimer) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
    }
    this.onReconnected();
    // Whichever side is receiving asks to resume; a no-op on the sending side.
    this.receiver.requestResume();
  }

  private onGraceExpired(): void {
    if (!this.reconnecting) return;
    this.reconnecting = false;
    this.graceTimer = null;
    // ICE-restart on the same connection didn't recover it. If a transfer is
    // still active and we know who to call, escalate to a FULL reconnect (a
    // fresh connection) and resume — rather than failing outright.
    if (this.hasActiveTransfer() && this.lastTarget) {
      this.beginFullReconnect();
      return;
    }
    this.failTransfer("connection_lost");
  }

  private hasActiveTransfer(): boolean {
    return this.activeSend !== null || this.receiver.hasInProgress();
  }

  // Terminal failure: reject an in-flight send, drop partial receives, notify.
  private failTransfer(reason: string): void {
    this.endFullReconnect();
    this.activeSend?.reject(new Error(reason));
    this.activeSend = null;
    this.receiver.failAll(reason);
    this.onDisconnected(reason);
  }

  // A total connection loss with a transfer still going. Keep the transfer state
  // and try to rebuild a fresh connection to the same peer; the resume protocol
  // then continues each side from its last contiguous seq.
  private loseConnection(reason: string): void {
    if (this.closing || this.fullReconnecting) return;
    if (this.hasActiveTransfer() && this.lastTarget) this.beginFullReconnect();
    else this.failTransfer(reason);
  }

  private beginFullReconnect(): void {
    if (this.fullReconnecting) return;
    this.fullReconnecting = true;
    this.fullAttempts = 0;
    this.reconnecting = false;
    if (this.graceTimer) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
    }
    this.activeSend?.aborter.abort(); // the pump remembers nextSeq
    this.onReconnecting();
    this.scheduleFullReconnect();
  }

  private scheduleFullReconnect(): void {
    if (!this.fullReconnecting) return;
    if (this.fullAttempts >= RECONNECT_MAX_ATTEMPTS) {
      this.fullReconnecting = false;
      this.failTransfer("connection_lost");
      return;
    }
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.fullAttempts, RECONNECT_MAX_DELAY_MS);
    this.fullAttempts += 1;
    this.fullTimer = setTimeout(() => this.attemptFullReconnect(), delay);
  }

  private attemptFullReconnect(): void {
    this.fullTimer = null;
    if (!this.fullReconnecting || !this.lastTarget) return;
    // Only the original caller re-places the call; the answering side just waits
    // for the resulting `ready`. Both keep retrying/waiting on the same schedule.
    if (this.initiator) {
      const t = this.lastTarget;
      if (t.kind === "device") this.send({ type: "call-device", targetDeviceId: t.id });
      else this.send({ type: "call", targetUserId: t.id });
    }
    this.scheduleFullReconnect();
  }

  private endFullReconnect(): void {
    this.fullReconnecting = false;
    this.fullAttempts = 0;
    if (this.fullTimer) {
      clearTimeout(this.fullTimer);
      this.fullTimer = null;
    }
  }

  // --- e2e-only hooks: exercise the resume protocol over the live channel.
  // Headless WebRTC can't be network-partitioned reliably, so these drive the
  // same code paths a real ICE restart would, without an actual outage. ---
  _testAbortSend(): void {
    this.activeSend?.aborter.abort();
  }
  _testRequestResume(): void {
    this.receiver.requestResume();
  }
  _testForceFail(): void {
    this.reconnecting = true;
    this.failTransfer("connection_lost");
  }
  _testReceiveProgress(): { id: string; received: number; total: number; contiguousSeq: number }[] {
    return this.receiver.snapshot();
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
    this.closing = true;
    this.endFullReconnect();
    if (this.graceTimer) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
    }
    this.channel?.close();
    this.pc?.close();
    this.ws?.close();
  }

  private connectSignaling(): WebSocket {
    // No-op while the cached credential is still fresh.
    void primeIceServers();
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
        // Mid-reconnect the peer may be momentarily unreachable; keep retrying on
        // the schedule rather than surfacing a hard failure.
        if (this.fullReconnecting) break;
        this.onCallFailed(message.reason);
        break;
      case "presence-snapshot":
        this.onPresenceSnapshot(message.online);
        break;
      case "presence-update":
        this.onPresenceUpdate(message.userId, message.online);
        break;
      case "my-devices-snapshot":
        this.onMyDevicesSnapshot(message.online);
        break;
      case "my-device-update":
        this.onMyDeviceUpdate(message.deviceId, message.online);
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
    this.initiator = initiator;

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.send({
          type: "signal",
          payload: { kind: "candidate", candidate: event.candidate.toJSON() } satisfies SignalPayload,
        });
      }
    };

    // "disconnected"/"failed" may be a transient blip — try to recover via ICE
    // restart within the grace window rather than failing the transfer outright.
    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      if (state === "disconnected" || state === "failed") this.onConnectionInterrupted();
      else if (state === "connected" || state === "completed") this.onConnectionRestored();
    };

    pc.onconnectionstatechange = () => {
      // Real teardown only. Transient failures are handled via ICE state above.
      // A close with a transfer still active escalates to a full reconnect.
      if (pc.connectionState === "closed") this.loseConnection("connection_closed");
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
    channel.onopen = () => {
      if (this.fullReconnecting) {
        // A fresh connection re-established mid-transfer: don't run the normal
        // "connected" flush (which would re-send / advance the queue). Resume in
        // place instead — the receiver asks the sender to continue from its last
        // contiguous seq; a sending side just waits for that resume-request.
        this.endFullReconnect();
        this.onReconnected();
        if (this.receiver.hasInProgress()) this.receiver.requestResume();
        return;
      }
      this.onConnected();
    };
    // A channel close during either kind of reconnect is not a hard failure —
    // the ICE grace window / full-reconnect loop decides the transfer's fate.
    channel.onclose = () => {
      if (!this.reconnecting && !this.fullReconnecting) this.loseConnection("channel_closed");
    };
    channel.onmessage = (event) => this.onChannelMessage(event.data);
  }

  // Intercepts resume/ack control messages (meant for the sender/receiver
  // orchestration here) and forwards everything else to the FileReceiver.
  private onChannelMessage(data: string | ArrayBuffer): void {
    if (typeof data === "string") {
      const msg = JSON.parse(data) as DataChannelMessage;
      switch (msg.type) {
        case "chunk-ack":
          if (this.activeSend?.id === msg.id) this.activeSend.ackedSeq = msg.contiguousSeq;
          return;
        case "resume-request":
          this.onResumeRequest(msg.id, msg.fromSeq);
          return;
        case "resume-response":
          return; // receiver side: sender agreed; nothing to do
      }
    }
    this.receiver.handleMessage(data);
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
