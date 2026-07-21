import { useCallback, useEffect, useRef, useState } from "react";
import { PeerConnection } from "../peer";
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

  const upsert = useCallback((id: string, update: Partial<Transfer> & Pick<Transfer, "id">) => {
    setTransfers((prev) => {
      const existing = prev.find((t) => t.id === id);
      if (existing) return prev.map((t) => (t.id === id ? { ...t, ...update } : t));
      return [...prev, { direction: "send", name: "", size: 0, transferred: 0, ...update, id }];
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
      peer.onConnected = () => setConnected(true);
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
    setConnected(false);
    setTransfers([]);
    setFolders([]);
    setError(null);
  }, []);

  useEffect(() => () => peerRef.current?.close(), []);

  return { connected, transfers, folders, error, setError, createRoom, joinRoom, sendFiles, sendFolder, reset };
}
