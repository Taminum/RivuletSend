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
import type { FolderEntry } from "../fileTransfer";
import { api } from "../api";
import { useAuth } from "../auth/AuthContext";
import {
  failureReasonText,
  type Transfer,
  type FolderTransfer,
  type CompletedTransfer,
} from "../transfers";

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
  // Folder transfers over the presence channel (contact or own device).
  folders: FolderTransfer[];
  sendFolderToContact: (userId: string, folderName: string, entries: FolderEntry[]) => void;
  sendFolderToDevice: (deviceId: string, folderName: string, entries: FolderEntry[]) => void;
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
  // A folder queued to send once the channel opens (mutually exclusive with files).
  const pendingFolderRef = useRef<{ folderName: string; entries: FolderEntry[] } | null>(null);
  const activeFolderRef = useRef<{
    folderId: string;
    folderName: string;
    totalFiles: number;
    totalBytes: number;
    peerId: string | null;
  } | null>(null);
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
  const [folders, setFolders] = useState<FolderTransfer[]>([]);

  const upsertFolder = useCallback(
    (folderId: string, update: Partial<FolderTransfer> & Pick<FolderTransfer, "folderId">) => {
      setFolders((prev) => {
        const existing = prev.find((f) => f.folderId === folderId);
        if (existing) return prev.map((f) => (f.folderId === folderId ? { ...f, ...update } : f));
        return [
          {
            folderName: "",
            direction: "send",
            filesDone: 0,
            totalFiles: 0,
            bytesTransferred: 0,
            totalBytes: 0,
            done: false,
            ...update,
            folderId,
          },
          ...prev,
        ];
      });
    },
    [],
  );
  const folderHistoryName = (name: string, count: number) => `${name}/ (${count} files)`;

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
      setFolders([]);
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
      // Flush the queued folder or files now that the channel is open, then
      // advance the queue to the next target (if any).
      const folder = pendingFolderRef.current;
      const files = pendingFilesRef.current;
      pendingFolderRef.current = null;
      pendingFilesRef.current = [];
      void (async () => {
        if (folder) {
          try {
            await peer.sendFolder(folder.folderName, folder.entries);
          } catch (err) {
            setCallError(String(err));
          }
        } else {
          for (const file of files) {
            try {
              await peer.sendFile(file);
            } catch (err) {
              setCallError(String(err));
            }
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
      // A folder send in flight failed too — record it.
      const fm = activeFolderRef.current;
      if (fm) {
        activeFolderRef.current = null;
        upsertFolder(fm.folderId, { folderId: fm.folderId, failed: true, reason: failureReasonText(reason) });
        completeRef.current?.({
          id: fm.folderId,
          name: folderHistoryName(fm.folderName, fm.totalFiles),
          size: fm.totalBytes,
          direction: "send",
          counterpartUserId: fm.peerId,
          status: "failed",
          reason: failureReasonText(reason),
        });
      }
      const hadFolder = fm !== null;
      activePeerRef.current = null;
      setActivePeerId(null);
      // A real mid-send drop of the current queued target: mark it failed and
      // move on so the rest of the batch still gets a chance.
      const q = queueRef.current;
      if (q && (hadInFlight || hadFolder)) {
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
      pendingFolderRef.current = null;
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
    peer.onFolderStart = (start, direction) => {
      upsertFolder(start.folderId, {
        folderId: start.folderId,
        folderName: start.folderName,
        direction,
        totalFiles: start.totalFiles,
        totalBytes: start.totalBytes,
        filesDone: 0,
        bytesTransferred: 0,
        done: false,
      });
      if (direction === "send") {
        activeFolderRef.current = {
          folderId: start.folderId,
          folderName: start.folderName,
          totalFiles: start.totalFiles,
          totalBytes: start.totalBytes,
          peerId: activePeerRef.current,
        };
      }
    };
    peer.onFolderProgress = (p, direction) => {
      const done = p.filesDone >= p.totalFiles;
      upsertFolder(p.folderId, {
        folderId: p.folderId,
        filesDone: p.filesDone,
        bytesTransferred: p.bytesTransferred,
        totalFiles: p.totalFiles,
        totalBytes: p.totalBytes,
        done,
      });
      if (direction === "send" && done && activeFolderRef.current?.folderId === p.folderId) {
        const meta = activeFolderRef.current;
        activeFolderRef.current = null;
        completeRef.current?.({
          id: p.folderId,
          name: folderHistoryName(meta.folderName, meta.totalFiles),
          size: p.totalBytes,
          direction: "send",
          counterpartUserId: meta.peerId,
          status: "completed",
        });
      }
    };
    peer.onIncomingFolder = (folder) => {
      upsertFolder(folder.folderId, { folderId: folder.folderId, done: true, incoming: folder });
      completeRef.current?.({
        id: folder.folderId,
        name: folderHistoryName(folder.folderName, folder.files.length),
        size: folder.files.reduce((n, f) => n + f.blob.size, 0),
        direction: "receive",
        counterpartUserId: activePeerRef.current,
        status: "completed",
      });
      // Desktop auto-save: write the whole tree to the configured folder.
      const native = typeof window !== "undefined" ? window.rivulet : undefined;
      if (native?.isDesktop && native.autoSaveFolder) {
        void (async () => {
          try {
            const files = await Promise.all(
              folder.files.map(async (f) => ({
                relativePath: f.relativePath,
                bytes: new Uint8Array(await f.blob.arrayBuffer()),
              })),
            );
            const res = await native.autoSaveFolder!({
              folderName: folder.folderName,
              files,
              fromContact: true,
            });
            if (res.saved && res.path) {
              upsertFolder(folder.folderId, { folderId: folder.folderId, savedPath: res.path });
            }
          } catch {
            /* fall back to the in-app Save/zip */
          }
        })();
      }
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
      setFolders([]);
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

  // Folder send over the presence channel (one target at a time). The folder is
  // flushed from pendingFolderRef once the channel opens.
  const sendFolder = useCallback(
    (kind: "contact" | "device", id: string, folderName: string, entries: FolderEntry[]) => {
      const peer = peerRef.current;
      if (!peer || !online || entries.length === 0) return;
      pendingFolderRef.current = { folderName, entries };
      queueRef.current = { ids: [id], files: [], index: 0, kind };
      setContactSendState({ [id]: "queued" });
      startCurrent();
    },
    [online, startCurrent],
  );
  const sendFolderToContact = useCallback(
    (userId: string, folderName: string, entries: FolderEntry[]) =>
      sendFolder("contact", userId, folderName, entries),
    [sendFolder],
  );
  const sendFolderToDevice = useCallback(
    (deviceId: string, folderName: string, entries: FolderEntry[]) =>
      sendFolder("device", deviceId, folderName, entries),
    [sendFolder],
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
        folders,
        sendFolderToContact,
        sendFolderToDevice,
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
