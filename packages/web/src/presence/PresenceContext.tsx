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

interface PresenceValue {
  online: boolean;
  callStatus: CallStatus;
  callError: string | null;
  activePeerId: string | null;
  transfers: Transfer[];
  sendToContact: (userId: string, files: File[]) => void;
  clearCallError: () => void;
}

const PresenceContext = createContext<PresenceValue | null>(null);

const CALL_FAILURE_MESSAGES: Record<CallFailureReason, string> = {
  offline: "They're not online right now.",
  "not-contact": "You need to be accepted contacts to send directly.",
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

  const [online, setOnline] = useState(false);
  const [callStatus, setCallStatus] = useState<CallStatus>("idle");
  const [callError, setCallError] = useState<string | null>(null);
  const [activePeerId, setActivePeerId] = useState<string | null>(null);
  const [transfers, setTransfers] = useState<Transfer[]>([]);

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
      return;
    }

    let cancelled = false;
    const peer = new PeerConnection();
    peerRef.current = peer;

    peer.onAuthed = () => {
      if (!cancelled) setOnline(true);
    };
    peer.onConnected = () => {
      setCallStatus("connected");
      // If we placed this call, flush the queued files now that the channel is open.
      const files = pendingFilesRef.current;
      pendingFilesRef.current = [];
      for (const file of files) {
        void peer.sendFile(file).catch((err) => setCallError(String(err)));
      }
    };
    peer.onDisconnected = (reason) => {
      setCallStatus("idle");
      // Any contact send still in flight failed — record it.
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
    };
    peer.onCallFailed = (reason) => {
      setCallStatus("idle");
      setCallError(CALL_FAILURE_MESSAGES[reason]);
      pendingFilesRef.current = [];
      activePeerRef.current = null;
      setActivePeerId(null);
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
      setCallStatus("idle");
      setActivePeerId(null);
    };
  }, [user, upsertTransfer]);

  const sendToContact = useCallback(
    (userId: string, files: File[]) => {
      const peer = peerRef.current;
      if (!peer || !online || files.length === 0) return;
      setCallError(null);
      pendingFilesRef.current = files;
      activePeerRef.current = userId;
      setActivePeerId(userId);
      setCallStatus("connecting");
      peer.callContact(userId);
    },
    [online],
  );

  const clearCallError = useCallback(() => setCallError(null), []);

  return (
    <PresenceContext.Provider
      value={{ online, callStatus, callError, activePeerId, transfers, sendToContact, clearCallError }}
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
