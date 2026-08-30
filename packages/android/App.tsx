import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import {theme} from './src/theme';
import {loadToken, setToken, ApiError} from './src/net/session';
import {
  api,
  contactName,
  type ApiDevice,
  type ContactEntry,
  type ApiUser,
} from './src/net/api';
import {Presence} from './src/net/presence';
import {CodeSession} from './src/net/codeSession';
import {TransferPeer} from './src/peer/peer';
import {pickFilesToSend, type PickedFile} from './src/files/pick';
import type {IncomingMeta, SendProgress} from './src/peer/transfer';
import {QrScanner} from './src/qr/Scanner';
import {codeToQrValue, extractCode} from './src/qr/format';

type Screen = 'loading' | 'pair' | 'home';

export default function App(): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>('loading');
  const [user, setUser] = useState<ApiUser | null>(null);

  useEffect(() => {
    (async () => {
      const token = await loadToken();
      if (!token) return setScreen('pair');
      try {
        const {user: u} = await api.me();
        setUser(u);
        setScreen('home');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) await setToken(null);
        setScreen('pair');
      }
    })();
  }, []);

  const onPaired = useCallback((u: ApiUser) => {
    setUser(u);
    setScreen('home');
  }, []);
  const onLogout = useCallback(async () => {
    await setToken(null);
    setUser(null);
    setScreen('pair');
  }, []);

  if (screen === 'loading') {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color={theme.accent} size="large" />
      </SafeAreaView>
    );
  }
  if (screen === 'pair') return <PairScreen onPaired={onPaired} />;
  return <HomeScreen user={user!} onLogout={onLogout} />;
}

// --- Pairing ---
function PairScreen({onPaired}: {onPaired: (u: ApiUser) => void}): React.JSX.Element {
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const requestCode = useCallback(async () => {
    setError(null);
    setCode(null);
    stopPolling();
    try {
      const {code: c} = await api.pairingRequest({platform: 'android', label: 'Android phone'});
      setCode(c);
      pollRef.current = setInterval(async () => {
        try {
          const res = await api.pairingStatus(c);
          if (res.status === 'approved' && res.token && res.user) {
            stopPolling();
            await setToken(res.token);
            onPaired(res.user);
          } else if (res.status === 'expired') {
            stopPolling();
            setCode(null);
            setError('Code expired — tap “New code”.');
          }
        } catch {
          /* keep polling */
        }
      }, 2000);
    } catch {
      setError('Could not reach the server. Check your connection and retry.');
    }
  }, [onPaired]);

  useEffect(() => {
    void requestCode();
    return stopPolling;
  }, [requestCode]);

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.brand}>OwlSend</Text>
        <Text style={styles.sub}>Link this phone to your account</Text>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Pairing code</Text>
          {code ? (
            <Text style={styles.code}>{code}</Text>
          ) : (
            <ActivityIndicator color={theme.accent} style={{marginVertical: 20}} />
          )}
          <Text style={styles.hint}>
            On OwlSend web/desktop (signed in): Settings → “Link a new device” →
            enter this code. Expires in ~2 min.
          </Text>
        </View>
        {error && <Text style={styles.error}>{error}</Text>}
        <TouchableOpacity style={styles.btnGhost} onPress={requestCode}>
          <Text style={styles.btnGhostText}>New code</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

// --- Home ---
type Tab = 'send' | 'code' | 'contacts';

type Status =
  | {kind: 'idle'}
  | {kind: 'waiting'; code: string}
  | {kind: 'calling'; label: string}
  | {kind: 'sending'; label: string; filesDone: number; totalFiles: number; name: string; pct: number}
  | {kind: 'receiving'; name: string; pct: number}
  | {kind: 'receivingFolder'; folder: string; filesDone: number; totalFiles: number}
  | {kind: 'done'; text: string; shareUrl?: string}
  | {kind: 'failed'; text: string};

function HomeScreen({user, onLogout}: {user: ApiUser; onLogout: () => void}): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('send');
  const [devices, setDevices] = useState<ApiDevice[]>([]);
  const [accepted, setAccepted] = useState<ContactEntry[]>([]);
  const [incoming, setIncoming] = useState<ContactEntry[]>([]);
  const [onlineDevices, setOnlineDevices] = useState<Set<string>>(new Set());
  const [onlineContacts, setOnlineContacts] = useState<Set<string>>(new Set());
  const [presenceUp, setPresenceUp] = useState(false);
  const [staged, setStaged] = useState<PickedFile[]>([]);
  const [status, setStatus] = useState<Status>({kind: 'idle'});
  const [scanning, setScanning] = useState(false);
  const [joinInput, setJoinInput] = useState('');
  const [email, setEmail] = useState('');
  const [busyAction, setBusyAction] = useState(false);

  const presenceRef = useRef<Presence | null>(null);
  const peerRef = useRef<TransferPeer | null>(null);
  const codeRef = useRef<CodeSession | null>(null);
  const pendingSendRef = useRef<PickedFile[] | null>(null);
  const pendingLabelRef = useRef<string>('');
  // Last incoming folder's name — kept so progress ticks can label themselves.
  const folderNameRef = useRef('folder');

  const teardownPeer = useCallback(() => {
    peerRef.current?.close();
    peerRef.current = null;
    codeRef.current?.close();
    codeRef.current = null;
    pendingSendRef.current = null;
  }, []);

  const makePeer = useCallback(
    (sendSignal: (payload: unknown) => void): TransferPeer => {
      const peer = new TransferPeer(sendSignal, {
        onConnected: () => {
          const files = pendingSendRef.current;
          if (files && files.length) {
            peer
              .sendFiles(files, (p: SendProgress) =>
                setStatus({
                  kind: 'sending',
                  label: pendingLabelRef.current,
                  filesDone: p.filesDone,
                  totalFiles: p.totalFiles,
                  name: p.currentName,
                  pct: p.totalBytes ? p.sentBytes / p.totalBytes : 0,
                }),
              )
              .then(() => {
                setStatus({
                  kind: 'done',
                  text: files.length > 1 ? `Sent ${files.length} files` : `Sent “${files[0].name}”`,
                });
                setStaged([]);
                teardownPeer();
              })
              .catch(() => {
                setStatus({kind: 'failed', text: 'Send failed'});
                teardownPeer();
              });
          }
        },
        onIncomingStart: (m: IncomingMeta) => setStatus({kind: 'receiving', name: m.name, pct: 0}),
        onIncomingProgress: (received, total) =>
          setStatus(s => (s.kind === 'receiving' ? {...s, pct: total ? received / total : 0} : s)),
        onIncomingFile: (m, location) => {
          setStatus({
            kind: 'done',
            text: `Received “${m.name}” → ${location.startsWith('content://') ? 'Downloads' : location}`,
            shareUrl: location,
          });
          teardownPeer();
        },
        onIncomingFolderStart: (folder, totalFiles) => {
          folderNameRef.current = folder;
          setStatus({kind: 'receivingFolder', folder, filesDone: 0, totalFiles});
        },
        onIncomingFolderProgress: (filesDone, totalFiles) =>
          setStatus({kind: 'receivingFolder', folder: folderNameRef.current, filesDone, totalFiles}),
        onIncomingFolderDone: (folder, totalFiles) => {
          setStatus({kind: 'done', text: `Received folder “${folder}” (${totalFiles} files) → Downloads/${folder}`});
          teardownPeer();
        },
        onDisconnected: () =>
          setStatus(s =>
            s.kind === 'sending' || s.kind === 'receiving' || s.kind === 'receivingFolder' || s.kind === 'calling'
              ? {kind: 'failed', text: 'Connection lost'}
              : s,
          ),
        onError: reason =>
          setStatus({
            kind: 'failed',
            text: reason === 'encrypted_unsupported' ? 'Encrypted transfers aren’t supported yet' : `Error: ${reason}`,
          }),
      });
      return peer;
    },
    [teardownPeer],
  );

  const refreshLists = useCallback(async () => {
    try {
      const [{devices: d}, c] = await Promise.all([api.listDevices(), api.listContacts()]);
      setDevices(d.filter(x => !x.isCurrent));
      setAccepted(c.accepted);
      setIncoming(c.incoming);
    } catch {
      /* keep prior */
    }
  }, []);

  useEffect(() => {
    void refreshLists();
    const presence = new Presence({
      onStatus: up => setPresenceUp(up),
      onDevicesChanged: s => setOnlineDevices(new Set(s)),
      onContactsChanged: s => setOnlineContacts(new Set(s)),
      onReady: initiator => {
        if (codeRef.current) return; // a code transfer owns the peer
        if (!peerRef.current) {
          peerRef.current = makePeer(p => presenceRef.current!.send({type: 'signal', payload: p}));
        }
        void peerRef.current.start(initiator);
        if (!initiator && !pendingSendRef.current?.length) {
          setStatus({kind: 'receiving', name: '…', pct: 0});
        }
      },
      onSignal: payload => peerRef.current?.handleSignal(payload),
      onPeerLeft: () => {
        setStatus(s =>
          s.kind === 'sending' || s.kind === 'receiving' || s.kind === 'receivingFolder' || s.kind === 'calling'
            ? {kind: 'failed', text: 'Peer left'}
            : s,
        );
        if (!codeRef.current) teardownPeer();
      },
      onCallFailed: reason => {
        setStatus({kind: 'failed', text: `Can’t connect: ${reason}`});
        teardownPeer();
      },
    });
    presenceRef.current = presence;
    void presence.connect();
    return () => {
      presence.close();
      peerRef.current?.close();
      codeRef.current?.close();
    };
  }, [makePeer, refreshLists, teardownPeer]);

  const onPick = useCallback(async () => {
    const files = await pickFilesToSend();
    if (files.length) {
      setStaged(files);
      setStatus({kind: 'idle'});
    }
  }, []);

  // Presence-based send to a device/contact.
  const startSend = useCallback(
    (target: {kind: 'device' | 'contact'; id: string; label: string}) => {
      if (!staged.length) return setStatus({kind: 'failed', text: 'Pick a file first'});
      teardownPeer();
      pendingSendRef.current = staged;
      pendingLabelRef.current = target.label;
      peerRef.current = makePeer(p => presenceRef.current!.send({type: 'signal', payload: p}));
      setStatus({kind: 'calling', label: target.label});
      const presence = presenceRef.current!;
      if (target.kind === 'device') presence.callDevice(target.id);
      else presence.callContact(target.id);
    },
    [staged, makePeer, teardownPeer],
  );

  // Code flow: create a room (share the code/QR). Sends staged files once a peer
  // joins; if nothing is staged, it waits to RECEIVE instead.
  const createRoom = useCallback(() => {
    teardownPeer();
    pendingSendRef.current = staged.length ? staged : null;
    pendingLabelRef.current = 'the other device';
    const cs = new CodeSession({
      onCode: c => setStatus({kind: 'waiting', code: c}),
      onReady: initiator => {
        if (!peerRef.current) peerRef.current = makePeer(p => cs.sendSignal(p));
        void peerRef.current.start(initiator);
        if (!initiator && !pendingSendRef.current?.length) setStatus({kind: 'receiving', name: '…', pct: 0});
      },
      onSignal: payload => peerRef.current?.handleSignal(payload),
      onPeerLeft: () =>
        setStatus(s =>
          s.kind === 'sending' || s.kind === 'receiving' || s.kind === 'receivingFolder' ? {kind: 'failed', text: 'Peer left'} : s,
        ),
      onError: msg => setStatus({kind: 'failed', text: msg}),
    });
    codeRef.current = cs;
    cs.create();
  }, [staged, makePeer, teardownPeer]);

  // Code flow: join a room by code (typed or scanned). Receives, or sends staged.
  const joinRoom = useCallback(
    (raw: string) => {
      const code = extractCode(raw);
      if (!code) return;
      teardownPeer();
      pendingSendRef.current = staged.length ? staged : null;
      pendingLabelRef.current = 'the other device';
      const cs = new CodeSession({
        onReady: initiator => {
          if (!peerRef.current) peerRef.current = makePeer(p => cs.sendSignal(p));
          void peerRef.current.start(initiator);
          if (!initiator && !pendingSendRef.current?.length) setStatus({kind: 'receiving', name: '…', pct: 0});
        },
        onSignal: payload => peerRef.current?.handleSignal(payload),
        onPeerLeft: () =>
          setStatus(s =>
            s.kind === 'sending' || s.kind === 'receiving' || s.kind === 'receivingFolder' ? {kind: 'failed', text: 'Peer left'} : s,
          ),
        onError: msg => setStatus({kind: 'failed', text: msg}),
      });
      codeRef.current = cs;
      setStatus({kind: 'calling', label: `code ${code}`});
      cs.join(code);
    },
    [staged, makePeer, teardownPeer],
  );

  const acceptContact = useCallback(
    async (userId: string) => {
      setBusyAction(true);
      try {
        await api.addContact({userId});
        await refreshLists();
      } catch {
        setStatus({kind: 'failed', text: 'Could not accept'});
      } finally {
        setBusyAction(false);
      }
    },
    [refreshLists],
  );

  const addByEmail = useCallback(async () => {
    const e = email.trim();
    if (!e) return;
    setBusyAction(true);
    try {
      await api.addContact({email: e});
      setEmail('');
      await refreshLists();
      setStatus({kind: 'done', text: `Request sent to ${e}`});
    } catch (err) {
      setStatus({kind: 'failed', text: err instanceof ApiError ? `Couldn’t add: ${err.code}` : 'Could not add'});
    } finally {
      setBusyAction(false);
    }
  }, [email, refreshLists]);

  const busy =
    status.kind === 'calling' ||
    status.kind === 'sending' ||
    status.kind === 'receiving' ||
    status.kind === 'receivingFolder';

  if (scanning) {
    return (
      <QrScanner
        onScan={value => {
          setScanning(false);
          joinRoom(value);
        }}
        onClose={() => setScanning(false)}
      />
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.brand}>OwlSend</Text>
            <Text style={styles.sub}>{user.displayName}</Text>
          </View>
          <View style={styles.presencePill}>
            <View style={[styles.dot, {backgroundColor: presenceUp ? theme.online : theme.faint}]} />
            <Text style={styles.presenceText}>{presenceUp ? 'Online' : 'Connecting…'}</Text>
          </View>
        </View>

        {/* Staged files / picker (shared across Send + Code tabs) */}
        <TouchableOpacity style={styles.pickBox} onPress={onPick} disabled={busy}>
          {staged.length ? (
            <>
              <Text style={styles.pickName} numberOfLines={1}>
                {staged.length === 1 ? staged[0].name : `${staged.length} files`}
              </Text>
              <Text style={styles.pickSize}>
                {formatBytes(staged.reduce((s, f) => s + f.size, 0))} · tap to change
              </Text>
            </>
          ) : (
            <Text style={styles.pickPrompt}>+ Pick file(s) to send</Text>
          )}
        </TouchableOpacity>

        {status.kind !== 'idle' && <StatusView status={status} />}

        {/* Tabs */}
        <View style={styles.tabs}>
          {(['send', 'code', 'contacts'] as Tab[]).map(t => (
            <TouchableOpacity key={t} style={[styles.tab, tab === t && styles.tabActive]} onPress={() => setTab(t)}>
              <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
                {t === 'send' ? 'My devices' : t === 'code' ? 'Code / QR' : 'Contacts'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {tab === 'send' && (
          <>
            <Text style={styles.section}>Your devices</Text>
            {devices.length === 0 ? (
              <Text style={styles.empty}>No other devices paired.</Text>
            ) : (
              devices.map(d => (
                <Target
                  key={d.id}
                  title={d.label}
                  subtitle={d.platform ?? 'device'}
                  online={onlineDevices.has(d.id)}
                  disabled={busy || !onlineDevices.has(d.id) || !staged.length}
                  onPress={() => startSend({kind: 'device', id: d.id, label: d.label})}
                />
              ))
            )}
            <Text style={styles.section}>Contacts</Text>
            {accepted.length === 0 ? (
              <Text style={styles.empty}>No contacts yet — add one in the Contacts tab.</Text>
            ) : (
              accepted.map(c => (
                <Target
                  key={c.user.id}
                  title={contactName(c)}
                  subtitle={c.user.email ?? 'contact'}
                  online={onlineContacts.has(c.user.id)}
                  disabled={busy || !onlineContacts.has(c.user.id) || !staged.length}
                  onPress={() => startSend({kind: 'contact', id: c.user.id, label: contactName(c)})}
                />
              ))
            )}
          </>
        )}

        {tab === 'code' && (
          <>
            {status.kind === 'waiting' ? (
              <View style={styles.qrCard}>
                <Text style={styles.cardTitle}>Share this code</Text>
                <Text style={styles.code}>{status.code}</Text>
                <View style={styles.qrWrap}>
                  <QRCode value={codeToQrValue(status.code)} size={200} backgroundColor="white" color="black" />
                </View>
                <Text style={styles.hint}>
                  {pendingSendRef.current?.length
                    ? 'On the other device, join with this code (or scan). Your files send automatically once it connects.'
                    : 'Waiting for the other device to send. Join with this code (or scan) on their end.'}
                </Text>
                <TouchableOpacity style={styles.btnGhost} onPress={teardownPeer}>
                  <Text style={styles.btnGhostText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <TouchableOpacity style={styles.btnPrimary} onPress={createRoom} disabled={busy}>
                  <Text style={styles.btnPrimaryText}>
                    {staged.length ? 'Get a code to send' : 'Get a code to receive'}
                  </Text>
                </TouchableOpacity>

                <Text style={styles.section}>Join a code</Text>
                <View style={styles.joinRow}>
                  <TextInput
                    style={[styles.input, {flex: 1}]}
                    value={joinInput}
                    onChangeText={setJoinInput}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    placeholder="ABCD12"
                    placeholderTextColor={theme.faint}
                  />
                  <TouchableOpacity
                    style={[styles.btnPrimary, {marginTop: 0}]}
                    disabled={busy || joinInput.trim().length < 4}
                    onPress={() => joinRoom(joinInput.trim())}>
                    <Text style={styles.btnPrimaryText}>Join</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity style={styles.btnGhost} onPress={() => setScanning(true)} disabled={busy}>
                  <Text style={styles.btnGhostText}>Scan a QR code</Text>
                </TouchableOpacity>
              </>
            )}
          </>
        )}

        {tab === 'contacts' && (
          <>
            {incoming.length > 0 && (
              <>
                <Text style={styles.section}>Requests</Text>
                {incoming.map(c => (
                  <View key={c.user.id} style={styles.targetRow}>
                    <View style={{flex: 1}}>
                      <Text style={styles.targetTitle}>{contactName(c)}</Text>
                      <Text style={styles.targetSub}>{c.user.email ?? 'wants to connect'}</Text>
                    </View>
                    <TouchableOpacity
                      style={styles.sendChip}
                      disabled={busyAction}
                      onPress={() => void acceptContact(c.user.id)}>
                      <Text style={styles.sendChipText}>Accept</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </>
            )}

            <Text style={styles.section}>Add a contact</Text>
            <View style={styles.joinRow}>
              <TextInput
                style={[styles.input, {flex: 1}]}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                placeholder="their@email.com"
                placeholderTextColor={theme.faint}
              />
              <TouchableOpacity
                style={[styles.btnPrimary, {marginTop: 0}]}
                disabled={busyAction || !email.trim()}
                onPress={() => void addByEmail()}>
                <Text style={styles.btnPrimaryText}>Add</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.section}>Your contacts</Text>
            {accepted.length === 0 ? (
              <Text style={styles.empty}>No contacts yet.</Text>
            ) : (
              accepted.map(c => (
                <View key={c.user.id} style={styles.targetRow}>
                  <View style={[styles.dot, {backgroundColor: onlineContacts.has(c.user.id) ? theme.online : theme.faint}]} />
                  <View style={{flex: 1}}>
                    <Text style={styles.targetTitle}>{contactName(c)}</Text>
                    <Text style={styles.targetSub}>{c.user.email ?? 'contact'}</Text>
                  </View>
                </View>
              ))
            )}
          </>
        )}

        <TouchableOpacity style={styles.btnGhost} onPress={onLogout}>
          <Text style={styles.btnGhostText}>Unlink this device</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function StatusView({status}: {status: Status}): React.JSX.Element {
  let text = '';
  let pct: number | null = null;
  let action: (() => void) | null = null;
  switch (status.kind) {
    case 'waiting':
      text = `Room ${status.code} — waiting…`;
      break;
    case 'calling':
      text = `Connecting to ${status.label}…`;
      break;
    case 'sending':
      text =
        status.totalFiles > 1
          ? `Sending ${status.filesDone}/${status.totalFiles}: ${status.name}`
          : `Sending “${status.name}” to ${status.label}`;
      pct = status.pct;
      break;
    case 'receiving':
      text = `Receiving “${status.name}”`;
      pct = status.pct;
      break;
    case 'receivingFolder':
      text = `Receiving folder “${status.folder}” (${status.filesDone}/${status.totalFiles})`;
      pct = status.totalFiles ? status.filesDone / status.totalFiles : 0;
      break;
    case 'done':
      text = status.text;
      if (status.shareUrl) action = () => void Share.share({url: status.shareUrl!}).catch(() => {});
      break;
    case 'failed':
      text = status.text;
      break;
  }
  return (
    <View style={[styles.statusCard, status.kind === 'failed' && styles.statusFail]}>
      <Text style={styles.statusText}>{text}</Text>
      {pct !== null && (
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, {width: `${Math.round(pct * 100)}%`}]} />
        </View>
      )}
      {action && (
        <TouchableOpacity onPress={action} style={{alignSelf: 'flex-start'}}>
          <Text style={styles.btnGhostText}>Share</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function Target({
  title,
  subtitle,
  online,
  disabled,
  onPress,
}: {
  title: string;
  subtitle: string;
  online: boolean;
  disabled: boolean;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <TouchableOpacity style={styles.targetRow} onPress={onPress} disabled={disabled}>
      <View style={[styles.dot, {backgroundColor: online ? theme.online : theme.faint}]} />
      <View style={{flex: 1}}>
        <Text style={styles.targetTitle}>{title}</Text>
        <Text style={styles.targetSub}>{online ? subtitle : `${subtitle} · offline`}</Text>
      </View>
      <View style={[styles.sendChip, disabled && styles.sendChipDisabled]}>
        <Text style={styles.sendChipText}>Send</Text>
      </View>
    </TouchableOpacity>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: theme.bg},
  center: {flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center'},
  content: {padding: 20, gap: 12, paddingBottom: 40},
  brand: {color: theme.text, fontSize: 24, fontWeight: '800'},
  sub: {color: theme.sub, fontSize: 14},
  headerRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start'},
  presencePill: {flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6},
  presenceText: {color: theme.sub, fontSize: 13},
  dot: {width: 9, height: 9, borderRadius: 5},

  card: {backgroundColor: theme.card, borderRadius: 14, padding: 18, marginTop: 10},
  qrCard: {backgroundColor: theme.card, borderRadius: 14, padding: 18, alignItems: 'center'},
  qrWrap: {backgroundColor: 'white', padding: 12, borderRadius: 10, marginVertical: 14},
  cardTitle: {color: theme.sub, fontSize: 13, textTransform: 'uppercase', letterSpacing: 1},
  code: {color: theme.text, fontSize: 40, fontWeight: '800', letterSpacing: 8, textAlign: 'center', marginVertical: 12},
  hint: {color: theme.faint, fontSize: 13, lineHeight: 18, textAlign: 'center'},
  error: {color: theme.danger, fontSize: 14, marginTop: 4},

  pickBox: {
    backgroundColor: theme.card,
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: theme.border,
    borderStyle: 'dashed',
  },
  pickPrompt: {color: theme.accent, fontSize: 16, fontWeight: '600', textAlign: 'center'},
  pickName: {color: theme.text, fontSize: 16, fontWeight: '600'},
  pickSize: {color: theme.sub, fontSize: 13, marginTop: 4},

  tabs: {flexDirection: 'row', backgroundColor: theme.cardAlt, borderRadius: 10, padding: 4, marginTop: 6},
  tab: {flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center'},
  tabActive: {backgroundColor: theme.card},
  tabText: {color: theme.sub, fontSize: 13, fontWeight: '600'},
  tabTextActive: {color: theme.text},

  section: {color: theme.sub, fontSize: 13, marginTop: 14, marginBottom: 2, fontWeight: '700'},
  empty: {color: theme.faint, fontSize: 14},

  targetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: theme.card,
    borderRadius: 12,
    padding: 14,
    marginTop: 8,
  },
  targetTitle: {color: theme.text, fontSize: 16, fontWeight: '600'},
  targetSub: {color: theme.sub, fontSize: 13, marginTop: 2},
  sendChip: {backgroundColor: theme.accent, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8},
  sendChipDisabled: {opacity: 0.35},
  sendChipText: {color: theme.text, fontWeight: '700', fontSize: 14},

  joinRow: {flexDirection: 'row', gap: 10, alignItems: 'center', marginTop: 6},
  input: {
    backgroundColor: theme.card,
    color: theme.text,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
  },

  statusCard: {backgroundColor: theme.card, borderRadius: 12, padding: 14, gap: 10},
  statusFail: {borderWidth: 1, borderColor: theme.danger},
  statusText: {color: theme.text, fontSize: 14},
  progressTrack: {height: 6, backgroundColor: theme.cardAlt, borderRadius: 3, overflow: 'hidden'},
  progressFill: {height: 6, backgroundColor: theme.accent},

  btnPrimary: {backgroundColor: theme.accent, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 18, alignItems: 'center', marginTop: 10},
  btnPrimaryText: {color: theme.text, fontWeight: '700', fontSize: 15},
  btnGhost: {marginTop: 16, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: theme.border, alignItems: 'center'},
  btnGhostText: {color: theme.accent, fontWeight: '600', fontSize: 15},
});
