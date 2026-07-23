import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { CallFailureReason } from "@p2p/shared";
import { PeerConnection } from "../peer";
import { api } from "../api";
import { useAuth } from "../auth/AuthContext";
import { failureReasonText, type Transfer, type CompletedTransfer } from "../transfers";

export type CallStatus = "idle" | "connecting" | "connected";
export type { CompletedTransfer };

// Per-contact phase while a (possibly multi-recipient) send queue runs.
export type ContactSendPhase = "queued" | "sending" | "sent" | "failed";

interface PresenceValue {
  online: boolean;
  callStatus: CallStatus;
  callError: string | null;
  activePeerId: string | null;
  transfers: Transfer[];
  // Ids of contacts currently online (per-contact presence from signaling).
  onlineContacts: Set<string>;
  isContactOnline: (userId: string) => boolean;
  sendToContact: (userId: string, files: File[]) => void;
  // Send the same files to several contacts, one after another (the presence
  // peer hosts a single call at a time). `contactSendState` tracks each one.
  sendToContacts: (userIds: string[], files: File[]) => void;
  contactSendState: Record<string, ContactSendPhase>;
  // Ids of my own paired devices currently online, and a direct self-send.
  onlineDevices: Set<string>;
  isDeviceOnline: (deviceId: string) => boolean;
  sendToDevice: (deviceId: string, files: File[]) => void;
  clearCallError: () => void;
}

const PresenceContext = createContext<PresenceValue | null>(null);

const CALL_FAILURE_MESSAGES: Record<CallFailureReason, string> = {
  offline: "They're not online right now.",
  "not-contact": "You need to be accepted contacts to send directly.",
  "not-your-device": "That device isn't one of yours, or it went offline.",
  self: "That's your own account.",
  unauthenticated: "Session expired — please reload.",
};

interface Props {
  children: ReactNode;
  // Called once per completed transfer, so the shell can record history.
  onTransferComplete?: (t: CompletedTransfer) => void;
}

export function PresenceProvider({ children, onTransferComplete }: Props) {
  const { user } = useAuth();
  const peerRef = useRef<PeerConnection | null>(null);
  const pendingFilesRef = useRef<File[]>([]);
  const activePeerRef = useRef<string | null>(null);
  const sentNamesRef = useRef<Map<string, string>>(new Map());
  const activeSendsRef = useRef<Map<string, { name: string; size: number; peerId: string | null }>>(
    new Map(),
  );
  const completeRef = useRef(onTransferComplete);
  completeRef.current = onTransferComplete;

  // Sequential send queue: the same files are delivered to each target in turn.
  // `kind` selects contact-call vs self-send to my own device.
  const queueRef = useRef<{
    ids: string[];
    files: File[];
    index: number;
    kind: "contact" | "device";
  } | null>(null);
  // Set right before we place the next call, so the resulting teardown of the
  // previous (already-drained) channel isn't mistaken for a real disconnect.
  const transitioningRef = useRef(false);
  const advanceRef = useRef<(fromOpenChannel: boolean) => void>(() => {});

  const [online, setOnline] = useState(false);
  const [callStatus, setCallStatus] = useState<CallStatus>("idle");
  const [callError, setCallError] = useState<string | null>(null);
  const [activePeerId, setActivePeerId] = useState<string | null>(null);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [contactSendState, setContactSendState] = useState<Record<string, ContactSendPhase>>({});
  const [onlineContacts, setOnlineContacts] = useState<Set<string>>(new Set());
  const [onlineDevices, setOnlineDevices] = useState<Set<string>>(new Set());

  const upsertTransfer = useCallback((id: string, update: Partial<Transfer> & Pick<Transfer, "id">) => {
    setTransfers((prev) => {
      const existing = prev.find((t) => t.id === id);
      if (existing) return prev.map((t) => (t.id === id ? { ...t, ...update } : t));
      return [{ direction: "send", name: "", size: 0, transferred: 0, ...update, id }, ...prev];
    });
  }, []);

  useEffect(() => {
    if (!user) {
      peerRef.current?.close();
      peerRef.current = null;
      setOnline(false);
      setOnlineContacts(new Set());
      setOnlineDevices(new Set());
      return;
    }

    let cancelled = false;
    const peer = new PeerConnection();
    peerRef.current = peer;

    peer.onAuthed = () => {
      if (!cancelled) setOnline(true);
    };
    peer.onPresenceSnapshot = (ids) => {
      if (!cancelled) setOnlineContacts(new Set(ids));
    };
    peer.onPresenceUpdate = (userId, isOnline) => {
      if (cancelled) return;
      setOnlineContacts((prev) => {
        const next = new Set(prev);
        if (isOnline) next.add(userId);
        else next.delete(userId);
        return next;
      });
    };
    peer.onMyDevicesSnapshot = (ids) => {
      if (!cancelled) setOnlineDevices(new Set(ids));
    };
    peer.onMyDeviceUpdate = (deviceId, isOnline) => {
      if (cancelled) return;
      setOnlineDevices((prev) => {
        const next = new Set(prev);
        if (isOnline) next.add(deviceId);
        else next.delete(deviceId);
        return next;
      });
    };
    peer.onConnected = () => {
      setCallStatus("connected");
      // If we placed this call, flush the queued files now that the channel is
      // open, then advance the queue to the next contact (if any).
      const files = pendingFilesRef.current;
      pendingFilesRef.current = [];
      void (async () => {
        for (const file of files) {
          try {
            await peer.sendFile(file);
          } catch (err) {
            setCallError(String(err));
          }
        }
        const q = queueRef.current;
        if (q) {
          // Capture the id before advancing: advanceRef mutates q.index, and a
          // lazy read inside the state updater would land on the wrong contact.
          const id = q.ids[q.index];
          setContactSendState((p) => ({ ...p, [id]: "sent" }));
          advanceRef.current(true);
        }
      })();
    };
    peer.onDisconnected = (reason) => {
      // Intentional teardown while moving to the next queued contact: the old
      // channel had already drained, so this isn't a failure — ignore it once.
      if (transitioningRef.current) {
        transitioningRef.current = false;
        return;
      }
      setCallStatus("idle");
      // Any contact send still in flight failed — record it.
      const hadInFlight = activeSendsRef.current.size > 0;
      for (const [id, meta] of activeSendsRef.current) {
        completeRef.current?.({
          id,
          name: meta.name,
          size: meta.size,
          direction: "send",
          counterpartUserId: meta.peerId,
          status: "failed",
          reason: failureReasonText(reason),
        });
      }
      activeSendsRef.current.clear();
      activePeerRef.current = null;
      setActivePeerId(null);
      // A real mid-send drop of the current queued contact: mark it failed and
      // move on so the rest of the batch still gets a chance.
      const q = queueRef.current;
      if (q && hadInFlight) {
        const id = q.ids[q.index];
        setContactSendState((p) => ({ ...p, [id]: "failed" }));
        advanceRef.current(false);
      }
    };
    peer.onCallFailed = (reason) => {
      // A failed call never tears down a channel, so no teardown is pending to
      // suppress — clear the flag in case it was set for this (now-dead) call.
      transitioningRef.current = false;
      setCallStatus("idle");
      setCallError(CALL_FAILURE_MESSAGES[reason]);
      pendingFilesRef.current = [];
      const q = queueRef.current;
      if (q) {
        const id = q.ids[q.index];
        setContactSendState((p) => ({ ...p, [id]: "failed" }));
        advanceRef.current(false);
      } else {
        activePeerRef.current = null;
        setActivePeerId(null);
      }
    };
    peer.onError = (message) => setCallError(message);
    peer.onSendStart = ({ id, name, size }) => {
      sentNamesRef.current.set(id, name);
      activeSendsRef.current.set(id, { name, size, peerId: activePeerRef.current });
      upsertTransfer(id, { id, name, size, direction: "send", transferred: 0 });
    };
    peer.onSendProgress = ({ id, sent, total }) => {
      upsertTransfer(id, { id, transferred: sent });
      if (sent >= total) {
        activeSendsRef.current.delete(id);
        completeRef.current?.({
          id,
          name: sentNamesRef.current.get(id) ?? "file",
          size: total,
          direction: "send",
          counterpartUserId: activePeerRef.current,
          status: "completed",
        });
        sentNamesRef.current.delete(id);
      }
    };
    peer.onReceiveProgress = ({ id, received, total }) =>
      upsertTransfer(id, { id, transferred: received, size: total, direction: "receive" });
    peer.onIncomingFile = (file) => {
      const url = URL.createObjectURL(file.blob);
      upsertTransfer(file.id, {
        id: file.id,
        name: file.name,
        size: file.size,
        direction: "receive",
        transferred: file.size,
        url,
        mimeType: file.mimeType,
      });
      // Desktop auto-save: this is the contact (presence) path, so it's eligible.
      // The main process decides whether it's actually on; a native notification
      // is shown there. We record the path so the UI can offer "Show in folder".
      const native = typeof window !== "undefined" ? window.rivulet : undefined;
      if (native?.isDesktop && native.autoSaveFile) {
        void (async () => {
          try {
            const bytes = new Uint8Array(await file.blob.arrayBuffer());
            const res = await native.autoSaveFile!({ name: file.name, bytes, fromContact: true });
            if (res.saved && res.path) upsertTransfer(file.id, { id: file.id, savedPath: res.path });
          } catch {
            /* fall back to the in-app Save button */
          }
        })();
      }
      completeRef.current?.({
        id: file.id,
        name: file.name,
        size: file.size,
        direction: "receive",
        counterpartUserId: activePeerRef.current,
        status: "completed",
      });
    };

    void (async () => {
      try {
        const { token } = await api.wsToken();
        if (cancelled) return;
        await peer.connectAuthenticated(token);
      } catch {
        if (!cancelled) setOnline(false);
      }
    })();

    return () => {
      cancelled = true;
      peer.close();
      peerRef.current = null;
      setOnline(false);
      setOnlineContacts(new Set());
      setOnlineDevices(new Set());
      setCallStatus("idle");
      setActivePeerId(null);
    };
  }, [user, upsertTransfer]);

  // Place the call for the queue's current contact.
  const startCurrent = useCallback(() => {
    const peer = peerRef.current;
    const q = queueRef.current;
    if (!peer || !q) return;
    const id = q.ids[q.index];
    setContactSendState((p) => ({ ...p, [id]: "sending" }));
    setCallError(null);
    pendingFilesRef.current = q.files;
    activePeerRef.current = id;
    setActivePeerId(id);
    setCallStatus("connecting");
    if (q.kind === "device") peer.callDevice(id);
    else peer.callContact(id);
  }, []);

  // Move to the next queued contact, or finish. `fromOpenChannel` is true when
  // the contact we just finished had a live channel that will now be torn down.
  const advanceQueue = useCallback(
    (fromOpenChannel: boolean) => {
      const q = queueRef.current;
      if (!q) return;
      const nextIndex = q.index + 1;
      if (nextIndex < q.ids.length) {
        q.index = nextIndex;
        if (fromOpenChannel) transitioningRef.current = true;
        startCurrent();
      } else {
        queueRef.current = null;
        transitioningRef.current = false;
        setCallStatus("idle");
        activePeerRef.current = null;
        setActivePeerId(null);
      }
    },
    [startCurrent],
  );
  advanceRef.current = advanceQueue;

  const sendToContacts = useCallback(
    (userIds: string[], files: File[]) => {
      const peer = peerRef.current;
      if (!peer || !online || files.length === 0 || userIds.length === 0) return;
      queueRef.current = { ids: [...userIds], files, index: 0, kind: "contact" };
      setContactSendState(Object.fromEntries(userIds.map((id) => [id, "queued" as ContactSendPhase])));
      startCurrent();
    },
    [online, startCurrent],
  );

  const sendToContact = useCallback(
    (userId: string, files: File[]) => sendToContacts([userId], files),
    [sendToContacts],
  );

  // Self-send: deliver files straight to one of my own online paired devices.
  const sendToDevice = useCallback(
    (deviceId: string, files: File[]) => {
      const peer = peerRef.current;
      if (!peer || !online || files.length === 0) return;
      queueRef.current = { ids: [deviceId], files, index: 0, kind: "device" };
      setContactSendState({ [deviceId]: "queued" });
      startCurrent();
    },
    [online, startCurrent],
  );

  const clearCallError = useCallback(() => setCallError(null), []);
  const isContactOnline = useCallback((userId: string) => onlineContacts.has(userId), [onlineContacts]);
  const isDeviceOnline = useCallback((deviceId: string) => onlineDevices.has(deviceId), [onlineDevices]);

  return (
    <PresenceContext.Provider
      value={{
        online,
        callStatus,
        callError,
        activePeerId,
        transfers,
        onlineContacts,
        isContactOnline,
        sendToContact,
        sendToContacts,
        contactSendState,
        onlineDevices,
        isDeviceOnline,
        sendToDevice,
        clearCallError,
      }}
    >
      {children}
    </PresenceContext.Provider>
  );
}

export function usePresence(): PresenceValue {
  const ctx = useContext(PresenceContext);
  if (!ctx) throw new Error("usePresence must be used within PresenceProvider");
  return ctx;
}
