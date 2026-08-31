import React, {createContext, useCallback, useContext, useEffect, useRef, useState} from 'react';
import {
  api,
  contactName,
  type ApiDevice,
  type ContactEntry,
  type ApiUser,
} from '../net/api';
import {Presence} from '../net/presence';
import {CodeSession} from '../net/codeSession';
import {TransferPeer, type ConnectionType} from '../peer/peer';
import {pickFilesToSend, type PickedFile} from '../files/pick';
import type {SendProgress} from '../peer/transfer';
import {addReceived, loadReceived, type ReceivedFile} from '../files/received';
import {extractCode} from '../qr/format';
import {startTransferService, updateTransferService, stopTransferService} from '../service/foreground';

// One live transfer at a time (send or receive). Everything the UI needs to draw
// the active-transfer card lives here.
export interface TransferState {
  direction: 'send' | 'receive';
  phase: 'connecting' | 'active' | 'done' | 'failed';
  label: string;
  connection: ConnectionType | null;
  name: string;
  doneBytes: number;
  totalBytes: number;
  speed: number; // bytes/sec
  filesDone: number;
  totalFiles: number;
  folder: string | null;
  error: string | null;
  shareUrl?: string;
}

interface AppStateValue {
  user: ApiUser;
  presenceUp: boolean;
  devices: ApiDevice[];
  onlineDevices: Set<string>;
  contacts: ContactEntry[];
  incoming: ContactEntry[];
  onlineContacts: Set<string>;
  staged: PickedFile[];
  transfer: TransferState | null;
  roomCode: string | null;
  received: ReceivedFile[];

  pickFiles: () => Promise<void>;
  clearStaged: () => void;
  sendToDevice: (id: string, label: string) => void;
  sendToContact: (id: string, label: string) => void;
  hostCode: () => void;
  joinCode: (raw: string) => void;
  cancel: () => void;
  dismissTransfer: () => void;

  refreshLists: () => Promise<void>;
  addContact: (email: string) => Promise<void>;
  acceptContact: (userId: string) => Promise<void>;
  removeContact: (userId: string) => Promise<void>;
  renameDevice: (id: string, label: string) => Promise<void>;
  unlinkDevice: (id: string) => Promise<void>;
  clearReceivedList: () => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AppStateValue | null>(null);
export const useApp = (): AppStateValue => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside provider');
  return v;
};

export function AppProvider({
  user,
  onLoggedOut,
  children,
}: {
  user: ApiUser;
  onLoggedOut: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  const [presenceUp, setPresenceUp] = useState(false);
  const [devices, setDevices] = useState<ApiDevice[]>([]);
  const [contacts, setContacts] = useState<ContactEntry[]>([]);
  const [incoming, setIncoming] = useState<ContactEntry[]>([]);
  const [onlineDevices, setOnlineDevices] = useState<Set<string>>(new Set());
  const [onlineContacts, setOnlineContacts] = useState<Set<string>>(new Set());
  const [staged, setStaged] = useState<PickedFile[]>([]);
  const [transfer, setTransfer] = useState<TransferState | null>(null);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [received, setReceived] = useState<ReceivedFile[]>([]);

  const presenceRef = useRef<Presence | null>(null);
  const peerRef = useRef<TransferPeer | null>(null);
  const codeRef = useRef<CodeSession | null>(null);
  const pendingRef = useRef<{files: PickedFile[] | null; label: string; recipientUserId?: string}>({
    files: null,
    label: '',
  });
  const speedRef = useRef<{t: number; b: number; speed: number}>({t: 0, b: 0, speed: 0});
  const transferRef = useRef<TransferState | null>(null);

  const patchTransfer = useCallback((patch: Partial<TransferState>) => {
    setTransfer(prev => {
      const base: TransferState =
        prev ??
        {
          direction: 'receive',
          phase: 'connecting',
          label: '',
          connection: null,
          name: '',
          doneBytes: 0,
          totalBytes: 0,
          speed: 0,
          filesDone: 0,
          totalFiles: 0,
          folder: null,
          error: null,
        };
      const next = {...base, ...patch};
      transferRef.current = next;
      return next;
    });
  }, []);

  // Start a fresh transfer card (resets stale bytes/speed from a prior one).
  const beginTransfer = useCallback((partial: Partial<TransferState>) => {
    speedRef.current = {t: 0, b: 0, speed: 0};
    const next: TransferState = {
      direction: 'receive',
      phase: 'connecting',
      label: '',
      connection: null,
      name: '',
      doneBytes: 0,
      totalBytes: 0,
      speed: 0,
      filesDone: 0,
      totalFiles: 0,
      folder: null,
      error: null,
      ...partial,
    };
    transferRef.current = next;
    setTransfer(next);
  }, []);

  const measureSpeed = useCallback((bytes: number): number => {
    const now = Date.now();
    const s = speedRef.current;
    if (s.t === 0) {
      speedRef.current = {t: now, b: bytes, speed: 0};
      return 0;
    }
    const dt = now - s.t;
    if (dt >= 500) {
      const speed = ((bytes - s.b) / dt) * 1000;
      speedRef.current = {t: now, b: bytes, speed};
      return speed;
    }
    return s.speed;
  }, []);

  const endTransfer = useCallback(() => {
    peerRef.current?.close();
    peerRef.current = null;
    codeRef.current?.close();
    codeRef.current = null;
    pendingRef.current = {files: null, label: ''};
    speedRef.current = {t: 0, b: 0, speed: 0};
    setRoomCode(null);
    void stopTransferService();
  }, []);

  const recordSent = useCallback(
    (fileName: string, fileSize: number, recipientUserId?: string) => {
      void api
        .createTransfer({recipientUserId, fileName, fileSize, status: 'completed'})
        .catch(() => {});
    },
    [],
  );

  const makePeer = useCallback(
    (sendSignal: (payload: unknown) => void): TransferPeer => {
      const peer = new TransferPeer(sendSignal, {
        onConnected: () => {
          const p = pendingRef.current;
          if (p.files && p.files.length) {
            const totalBytes = p.files.reduce((s, f) => s + f.size, 0);
            void startTransferService(`Sending to ${p.label}`);
            patchTransfer({
              direction: 'send',
              phase: 'active',
              label: p.label,
              name: p.files[0].name,
              totalBytes,
              totalFiles: p.files.length,
              filesDone: 0,
              doneBytes: 0,
            });
            peer
              .sendFiles(p.files, (sp: SendProgress) => {
                const speed = measureSpeed(sp.sentBytes);
                patchTransfer({
                  phase: 'active',
                  name: sp.currentName,
                  filesDone: sp.filesDone,
                  totalFiles: sp.totalFiles,
                  doneBytes: sp.sentBytes,
                  totalBytes: sp.totalBytes,
                  speed,
                });
                void updateTransferService(`Sending ${Math.round((sp.sentBytes / (sp.totalBytes || 1)) * 100)}%`);
              })
              .then(() => {
                const label = p.files!.length > 1 ? `${p.files!.length} files` : p.files![0].name;
                recordSent(label, totalBytes, p.recipientUserId);
                patchTransfer({phase: 'done', name: label, speed: 0});
                setStaged([]);
                endTransfer();
              })
              .catch(() => {
                patchTransfer({phase: 'failed', error: 'Send failed'});
                endTransfer();
              });
          } else {
            patchTransfer({direction: 'receive', phase: 'active', label: p.label || 'peer'});
          }
        },
        onConnectionType: type => patchTransfer({connection: type}),
        onIncomingStart: m => {
          void startTransferService(`Receiving ${m.name}`);
          patchTransfer({
            direction: 'receive',
            phase: 'active',
            name: m.name,
            totalBytes: m.size,
            doneBytes: 0,
            folder: null,
            totalFiles: 1,
            filesDone: 0,
          });
        },
        onIncomingProgress: (recv, total) => {
          const speed = measureSpeed(recv);
          patchTransfer({phase: 'active', doneBytes: recv, totalBytes: total, speed});
        },
        onIncomingFile: (m, location) => {
          void addReceived({
            id: m.id,
            name: m.name,
            size: m.size,
            mimeType: m.mimeType,
            location,
            at: Date.now(),
          }).then(setReceived);
          patchTransfer({phase: 'done', name: m.name, shareUrl: location, speed: 0});
          endTransfer();
        },
        onIncomingFolderStart: (folder, totalFiles) => {
          void startTransferService(`Receiving folder ${folder}`);
          patchTransfer({direction: 'receive', phase: 'active', folder, filesDone: 0, totalFiles, name: folder});
        },
        onIncomingFolderProgress: (filesDone, totalFiles) =>
          patchTransfer({phase: 'active', filesDone, totalFiles}),
        onIncomingFolderDone: (folder, totalFiles) => {
          void loadReceived().then(setReceived);
          patchTransfer({phase: 'done', folder, filesDone: totalFiles, totalFiles, name: folder, speed: 0});
          endTransfer();
        },
        onDisconnected: () => {
          if (transferRef.current && (transferRef.current.phase === 'active' || transferRef.current.phase === 'connecting')) {
            patchTransfer({phase: 'failed', error: 'Connection lost'});
            endTransfer();
          }
        },
        onError: reason => {
          patchTransfer({
            phase: 'failed',
            error: reason === 'encrypted_unsupported' ? 'Encrypted transfers aren’t supported yet' : `Error: ${reason}`,
          });
          endTransfer();
        },
      });
      return peer;
    },
    [patchTransfer, measureSpeed, recordSent, endTransfer],
  );

  const refreshLists = useCallback(async () => {
    try {
      const [{devices: d}, c] = await Promise.all([api.listDevices(), api.listContacts()]);
      setDevices(d.filter(x => !x.isCurrent));
      setContacts(c.accepted);
      setIncoming(c.incoming);
    } catch {
      /* keep prior */
    }
  }, []);

  useEffect(() => {
    void refreshLists();
    void loadReceived().then(setReceived);
    const presence = new Presence({
      onStatus: setPresenceUp,
      onDevicesChanged: s => setOnlineDevices(new Set(s)),
      onContactsChanged: s => setOnlineContacts(new Set(s)),
      onReady: initiator => {
        if (codeRef.current) return;
        if (!peerRef.current) {
          peerRef.current = makePeer(p => presenceRef.current!.send({type: 'signal', payload: p}));
        }
        void peerRef.current.start(initiator);
        if (!initiator && !pendingRef.current.files?.length) {
          beginTransfer({direction: 'receive', phase: 'connecting', label: 'incoming', name: '…'});
        }
      },
      onSignal: payload => peerRef.current?.handleSignal(payload),
      onPeerLeft: () => {
        if (!codeRef.current && transferRef.current?.phase === 'active') {
          patchTransfer({phase: 'failed', error: 'Peer left'});
          endTransfer();
        }
      },
      onCallFailed: reason => {
        patchTransfer({phase: 'failed', error: `Can’t connect: ${reason}`});
        endTransfer();
      },
    });
    presenceRef.current = presence;
    void presence.connect();
    return () => {
      presence.close();
      peerRef.current?.close();
      codeRef.current?.close();
      void stopTransferService();
    };
  }, [makePeer, refreshLists, patchTransfer, beginTransfer, endTransfer]);

  const pickFiles = useCallback(async () => {
    const files = await pickFilesToSend();
    if (files.length) setStaged(files);
  }, []);
  const clearStaged = useCallback(() => setStaged([]), []);

  const beginPresenceSend = useCallback(
    (target: {kind: 'device' | 'contact'; id: string; label: string}) => {
      if (!staged.length) return;
      endTransfer();
      pendingRef.current = {
        files: staged,
        label: target.label,
        recipientUserId: target.kind === 'contact' ? target.id : undefined,
      };
      peerRef.current = makePeer(p => presenceRef.current!.send({type: 'signal', payload: p}));
      beginTransfer({direction: 'send', phase: 'connecting', label: target.label});
      const presence = presenceRef.current!;
      if (target.kind === 'device') presence.callDevice(target.id);
      else presence.callContact(target.id);
    },
    [staged, makePeer, beginTransfer, endTransfer],
  );

  const sendToDevice = useCallback(
    (id: string, label: string) => beginPresenceSend({kind: 'device', id, label}),
    [beginPresenceSend],
  );
  const sendToContact = useCallback(
    (id: string, label: string) => beginPresenceSend({kind: 'contact', id, label}),
    [beginPresenceSend],
  );

  const startCode = useCallback(
    (mode: 'host' | 'join', code?: string) => {
      endTransfer();
      pendingRef.current = {files: staged.length ? staged : null, label: 'the other device'};
      const cs = new CodeSession({
        onCode: c => setRoomCode(c),
        onReady: initiator => {
          if (!peerRef.current) peerRef.current = makePeer(p => cs.sendSignal(p));
          void peerRef.current.start(initiator);
          beginTransfer({
            direction: pendingRef.current.files?.length ? 'send' : 'receive',
            phase: 'connecting',
            label: 'code',
          });
        },
        onSignal: payload => peerRef.current?.handleSignal(payload),
        onPeerLeft: () => {
          if (transferRef.current?.phase === 'active') {
            patchTransfer({phase: 'failed', error: 'Peer left'});
            endTransfer();
          }
        },
        onError: msg => {
          patchTransfer({phase: 'failed', error: msg});
          endTransfer();
        },
      });
      codeRef.current = cs;
      if (mode === 'host') cs.create();
      else if (code) cs.join(code);
    },
    [staged, makePeer, patchTransfer, beginTransfer, endTransfer],
  );

  const hostCode = useCallback(() => startCode('host'), [startCode]);
  const joinCode = useCallback(
    (raw: string) => {
      const code = extractCode(raw);
      if (code) startCode('join', code);
    },
    [startCode],
  );

  const cancel = useCallback(() => {
    endTransfer();
    setTransfer(null);
    transferRef.current = null;
  }, [endTransfer]);

  const dismissTransfer = useCallback(() => {
    setTransfer(null);
    transferRef.current = null;
  }, []);

  const addContactAction = useCallback(
    async (email: string) => {
      await api.addContact({email: email.trim()});
      await refreshLists();
    },
    [refreshLists],
  );
  const acceptContact = useCallback(
    async (userId: string) => {
      await api.addContact({userId});
      await refreshLists();
    },
    [refreshLists],
  );
  const removeContact = useCallback(
    async (userId: string) => {
      await api.deleteContact(userId);
      await refreshLists();
    },
    [refreshLists],
  );
  const renameDeviceAction = useCallback(
    async (id: string, label: string) => {
      await api.renameDevice(id, label);
      await refreshLists();
    },
    [refreshLists],
  );
  const unlinkDevice = useCallback(
    async (id: string) => {
      await api.revokeDevice(id);
      await refreshLists();
    },
    [refreshLists],
  );
  const clearReceivedList = useCallback(async () => {
    const {clearReceived} = await import('../files/received');
    await clearReceived();
    setReceived([]);
  }, []);

  const logout = useCallback(async () => {
    endTransfer();
    presenceRef.current?.close();
    const {setToken} = await import('../net/session');
    await setToken(null);
    onLoggedOut();
  }, [endTransfer, onLoggedOut]);

  const value: AppStateValue = {
    user,
    presenceUp,
    devices,
    onlineDevices,
    contacts,
    incoming,
    onlineContacts,
    staged,
    transfer,
    roomCode,
    received,
    pickFiles,
    clearStaged,
    sendToDevice,
    sendToContact,
    hostCode,
    joinCode,
    cancel,
    dismissTransfer,
    refreshLists,
    addContact: addContactAction,
    acceptContact,
    removeContact,
    renameDevice: renameDeviceAction,
    unlinkDevice,
    clearReceivedList,
    logout,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// Small shared formatter re-exported for screens.
export {contactName};
