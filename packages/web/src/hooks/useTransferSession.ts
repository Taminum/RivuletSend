import { useCallback, useEffect, useRef, useState } from "react";
import { PeerConnection } from "../peer";
import { SpeedTracker } from "../speedTracker";
import type { FolderEntry } from "../fileTransfer";
import {
  failureReasonText,
  type Transfer,
  type FolderTransfer,
  type CompletedTransfer,
} from "../transfers";

// Wraps a PeerConnection and the transfer-list state shared by the Send and
// Receive views. onComplete fires once per finished transfer (for history).
export function useTransferSession(onComplete?: (t: CompletedTransfer) => void) {
  const peerRef = useRef<PeerConnection | null>(null);
  const passphraseRef = useRef<string | null>(null);
  const sentNames = useRef<Map<string, string>>(new Map());
  // Sends that have started but not finished — used to record failures on disconnect.
  const activeSends = useRef<Map<string, { name: string; size: number }>>(new Map());
  const activeFolder = useRef<{ folderId: string; folderName: string; totalFiles: number; totalBytes: number } | null>(null);
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;

  const [connected, setConnected] = useState(false);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [folders, setFolders] = useState<FolderTransfer[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Per-transfer rolling-window speed trackers, for the live speed + ETA + sparkline.
  const trackerRef = useRef<Map<string, SpeedTracker>>(new Map());

  const upsert = useCallback((id: string, update: Partial<Transfer> & Pick<Transfer, "id">) => {
    // Sample the tracker outside the state updater (it mutates), then fold the
    // smoothed rate/ETA/history into the transfer.
    let rate: number | null = null;
    let history: number[] | undefined;
    if (typeof update.transferred === "number") {
      let tracker = trackerRef.current.get(id);
      if (!tracker) {
        tracker = new SpeedTracker();
        trackerRef.current.set(id, tracker);
      }
      rate = tracker.sample(update.transferred);
      history = tracker.history.slice();
    }

    setTransfers((prev) => {
      const existing = prev.find((t) => t.id === id);
      const merged: Transfer = existing
        ? { ...existing, ...update }
        : { direction: "send", name: "", size: 0, transferred: 0, ...update, id };

      if (typeof update.transferred === "number") {
        merged.speed = rate ?? undefined; // undefined while calibrating
        merged.rateHistory = history;
        merged.etaSeconds =
          rate != null && rate > 0 && merged.size > 0
            ? Math.max(0, (merged.size - merged.transferred) / rate)
            : undefined;
      }

      if (existing) return prev.map((t) => (t.id === id ? merged : t));
      return [...prev, merged];
    });
  }, []);

  const upsertFolder = useCallback(
    (folderId: string, update: Partial<FolderTransfer> & Pick<FolderTransfer, "folderId">) => {
      setFolders((prev) => {
        const existing = prev.find((f) => f.folderId === folderId);
        if (existing) return prev.map((f) => (f.folderId === folderId ? { ...f, ...update } : f));
        return [
          ...prev,
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
        ];
      });
    },
    [],
  );

  const folderHistoryName = (name: string, count: number) => `${name}/ (${count} files)`;

  const getPeer = useCallback((): PeerConnection => {
    if (!peerRef.current) {
      const peer = new PeerConnection();
      peer.setPassphrase(passphraseRef.current); // carry any passphrase set before the peer existed
      // Dev/e2e only: lets the reconnect-resume test drive the resume protocol
      // over the live channel (headless WebRTC can't be network-partitioned).
      if (import.meta.env.DEV) (window as unknown as { __peer?: PeerConnection }).__peer = peer;
      peer.onConnected = () => setConnected(true);
      // On a same-session reconnect, drop the pre-disconnect rate samples so the
      // speedometer recalibrates instead of showing a stale number.
      peer.onReconnected = () => trackerRef.current.forEach((tr) => tr.reset());
      peer.onDisconnected = (reason) => {
        setConnected(false);
        // Any send still in flight failed — record it with the reason.
        for (const [id, meta] of activeSends.current) {
          completeRef.current?.({
            id,
            name: meta.name,
            size: meta.size,
            direction: "send",
            counterpartUserId: null,
            status: "failed",
            reason: failureReasonText(reason),
          });
        }
        activeSends.current.clear();
        const fm = activeFolder.current;
        if (fm) {
          activeFolder.current = null;
          upsertFolder(fm.folderId, { folderId: fm.folderId, failed: true, reason: failureReasonText(reason) });
          completeRef.current?.({
            id: fm.folderId,
            name: folderHistoryName(fm.folderName, fm.totalFiles),
            size: fm.totalBytes,
            direction: "send",
            counterpartUserId: null,
            status: "failed",
            reason: failureReasonText(reason),
          });
        }
      };
      peer.onError = (m) => setError(m);
      peer.onSendStart = ({ id, name, size }) => {
        sentNames.current.set(id, name);
        activeSends.current.set(id, { name, size });
        upsert(id, { id, name, size, direction: "send", transferred: 0 });
      };
      peer.onSendProgress = ({ id, sent, total }) => {
        upsert(id, { id, transferred: sent });
        if (sent >= total) {
          activeSends.current.delete(id);
          completeRef.current?.({
            id,
            name: sentNames.current.get(id) ?? "file",
            size: total,
            direction: "send",
            counterpartUserId: null,
            status: "completed",
          });
          sentNames.current.delete(id);
        }
      };
      peer.onReceiveProgress = ({ id, received, total }) =>
        upsert(id, { id, transferred: received, size: total, direction: "receive" });
      peer.onIncomingFile = (file) => {
        const url = URL.createObjectURL(file.blob);
        upsert(file.id, {
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
          counterpartUserId: null,
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
          activeFolder.current = {
            folderId: start.folderId,
            folderName: start.folderName,
            totalFiles: start.totalFiles,
            totalBytes: start.totalBytes,
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
        if (direction === "send" && done && activeFolder.current?.folderId === p.folderId) {
          const meta = activeFolder.current;
          activeFolder.current = null;
          completeRef.current?.({
            id: p.folderId,
            name: folderHistoryName(meta.folderName, meta.totalFiles),
            size: p.totalBytes,
            direction: "send",
            counterpartUserId: null,
            status: "completed",
          });
        }
      };
      peer.onIncomingFolder = (folder) => {
        upsertFolder(folder.folderId, { folderId: folder.folderId, done: true, incoming: folder });
      };
      peerRef.current = peer;
    }
    return peerRef.current;
  }, [upsert]);

  const createRoom = useCallback(async () => {
    setError(null);
    return getPeer().createRoom();
  }, [getPeer]);

  const joinRoom = useCallback(
    async (code: string) => {
      setError(null);
      await getPeer().joinRoom(code);
    },
    [getPeer],
  );

  const sendFiles = useCallback(
    async (files: File[]) => {
      const peer = getPeer();
      for (const file of files) {
        try {
          await peer.sendFile(file);
        } catch (err) {
          setError((err as Error).message);
        }
      }
    },
    [getPeer],
  );

  const sendFolder = useCallback(
    async (folderName: string, entries: FolderEntry[]) => {
      try {
        await getPeer().sendFolder(folderName, entries);
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [getPeer],
  );

  const reset = useCallback(() => {
    peerRef.current?.close();
    peerRef.current = null;
    activeFolder.current = null;
    trackerRef.current.clear();
    setConnected(false);
    setTransfers([]);
    setFolders([]);
    setError(null);
  }, []);

  useEffect(() => () => peerRef.current?.close(), []);

  // Set the E2EE passphrase (never transmitted). Applies to the live peer and
  // is remembered for a peer created later.
  const setPassphrase = useCallback((passphrase: string | null) => {
    passphraseRef.current = passphrase || null;
    peerRef.current?.setPassphrase(passphraseRef.current);
  }, []);

  return { connected, transfers, folders, error, setError, createRoom, joinRoom, sendFiles, sendFolder, reset, setPassphrase };
}
