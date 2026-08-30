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
import {theme} from './src/theme';
import {loadToken, setToken, ApiError} from './src/net/session';
import {api, contactName, type ApiDevice, type ContactEntry, type ApiUser} from './src/net/api';
import {Presence} from './src/net/presence';
import {TransferPeer} from './src/peer/peer';
import {pickFileToSend, type PickedFile} from './src/files/pick';
import type {IncomingMeta} from './src/peer/transfer';

type Screen = 'loading' | 'pair' | 'home';

export default function App(): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>('loading');
  const [user, setUser] = useState<ApiUser | null>(null);

  // Decide the initial screen: a stored token that still resolves /auth/me means
  // we're paired; anything else sends us to pairing.
  useEffect(() => {
    (async () => {
      const token = await loadToken();
      if (!token) return setScreen('pair');
      try {
        const {user: u} = await api.me();
        setUser(u);
        setScreen('home');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          await setToken(null);
        }
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
  if (screen === 'pair') {
    return <PairScreen onPaired={onPaired} />;
  }
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
            setError('Code expired — tap to get a new one.');
          }
        } catch {
          /* transient — keep polling */
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
            On OwlSend web or desktop (already signed in), open Settings → “Link a
            device” and enter this code. It expires in ~2 minutes.
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
type Status =
  | {kind: 'idle'}
  | {kind: 'calling'; label: string}
  | {kind: 'sending'; label: string; pct: number}
  | {kind: 'receiving'; name: string; pct: number}
  | {kind: 'done'; text: string; shareUrl?: string}
  | {kind: 'failed'; text: string};

function HomeScreen({
  user,
  onLogout,
}: {
  user: ApiUser;
  onLogout: () => void;
}): React.JSX.Element {
  const [devices, setDevices] = useState<ApiDevice[]>([]);
  const [contacts, setContacts] = useState<ContactEntry[]>([]);
  const [onlineDevices, setOnlineDevices] = useState<Set<string>>(new Set());
  const [onlineContacts, setOnlineContacts] = useState<Set<string>>(new Set());
  const [presenceUp, setPresenceUp] = useState(false);
  const [staged, setStaged] = useState<PickedFile | null>(null);
  const [status, setStatus] = useState<Status>({kind: 'idle'});

  const presenceRef = useRef<Presence | null>(null);
  const peerRef = useRef<TransferPeer | null>(null);
  // What we intend to send once a connection opens (sender path).
  const pendingSendRef = useRef<PickedFile | null>(null);
  const pendingLabelRef = useRef<string>('');

  const teardownPeer = useCallback(() => {
    peerRef.current?.close();
    peerRef.current = null;
    pendingSendRef.current = null;
  }, []);

  const makePeer = useCallback((): TransferPeer => {
    const presence = presenceRef.current!;
    const peer = new TransferPeer(payload => presence.send({type: 'signal', payload}), {
      onConnected: () => {
        const file = pendingSendRef.current;
        if (file) {
          setStatus({kind: 'sending', label: pendingLabelRef.current, pct: 0});
          peer
            .sendFile(file, (sent, total) =>
              setStatus({
                kind: 'sending',
                label: pendingLabelRef.current,
                pct: total ? sent / total : 0,
              }),
            )
            .then(() => {
              setStatus({kind: 'done', text: `Sent “${file.name}”`});
              setStaged(null);
              pendingSendRef.current = null;
              teardownPeer();
            })
            .catch(() => {
              setStatus({kind: 'failed', text: 'Send failed'});
              teardownPeer();
            });
        }
      },
      onIncomingStart: (m: IncomingMeta) =>
        setStatus({kind: 'receiving', name: m.name, pct: 0}),
      onIncomingProgress: (received, total) =>
        setStatus(s =>
          s.kind === 'receiving' ? {...s, pct: total ? received / total : 0} : s,
        ),
      onIncomingFile: (m, location) => {
        setStatus({
          kind: 'done',
          text: `Received “${m.name}” → ${location.startsWith('content://') ? 'Downloads' : location}`,
          shareUrl: location,
        });
        teardownPeer();
      },
      onDisconnected: () => {
        // Only surface if we were mid-transfer; an idle close is expected.
        setStatus(s =>
          s.kind === 'sending' || s.kind === 'receiving' || s.kind === 'calling'
            ? {kind: 'failed', text: 'Connection lost'}
            : s,
        );
      },
      onError: reason => setStatus({kind: 'failed', text: `Error: ${reason}`}),
    });
    return peer;
  }, [teardownPeer]);

  const refreshLists = useCallback(async () => {
    try {
      const [{devices: d}, c] = await Promise.all([api.listDevices(), api.listContacts()]);
      setDevices(d.filter(x => !x.isCurrent));
      setContacts(c.accepted);
    } catch {
      /* leave whatever we had */
    }
  }, []);

  // Presence connection + list load, once.
  useEffect(() => {
    void refreshLists();
    const presence = new Presence({
      onStatus: up => setPresenceUp(up),
      onDevicesChanged: s => setOnlineDevices(new Set(s)),
      onContactsChanged: s => setOnlineContacts(new Set(s)),
      onReady: initiator => {
        // Someone connected. Reuse the pending peer if we started the call;
        // otherwise this is an incoming transfer — build a receiver peer.
        if (!peerRef.current) peerRef.current = makePeer();
        void peerRef.current.start(initiator);
        if (!initiator && !pendingSendRef.current) {
          setStatus({kind: 'receiving', name: '…', pct: 0});
        }
      },
      onSignal: payload => peerRef.current?.handleSignal(payload),
      onPeerLeft: () => {
        setStatus(s =>
          s.kind === 'sending' || s.kind === 'receiving' || s.kind === 'calling'
            ? {kind: 'failed', text: 'Peer left'}
            : s,
        );
        teardownPeer();
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
    };
  }, [makePeer, refreshLists, teardownPeer]);

  const onPick = useCallback(async () => {
    const file = await pickFileToSend();
    if (file) {
      setStaged(file);
      setStatus({kind: 'idle'});
    }
  }, []);

  const startSend = useCallback(
    (target: {kind: 'device' | 'contact'; id: string; label: string}) => {
      if (!staged) {
        setStatus({kind: 'failed', text: 'Pick a file first'});
        return;
      }
      if (peerRef.current) teardownPeer();
      pendingSendRef.current = staged;
      pendingLabelRef.current = target.label;
      peerRef.current = makePeer();
      setStatus({kind: 'calling', label: target.label});
      const presence = presenceRef.current!;
      if (target.kind === 'device') presence.callDevice(target.id);
      else presence.callContact(target.id);
    },
    [staged, makePeer, teardownPeer],
  );

  const busy = status.kind === 'calling' || status.kind === 'sending' || status.kind === 'receiving';

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

        {/* Staged file / picker */}
        <TouchableOpacity style={styles.pickBox} onPress={onPick} disabled={busy}>
          {staged ? (
            <>
              <Text style={styles.pickName} numberOfLines={1}>
                {staged.name}
              </Text>
              <Text style={styles.pickSize}>{formatBytes(staged.size)} · tap to change</Text>
            </>
          ) : (
            <Text style={styles.pickPrompt}>+ Pick a file to send</Text>
          )}
        </TouchableOpacity>

        {status.kind !== 'idle' && <StatusBar status={status} />}

        {/* Devices */}
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
              disabled={busy || !onlineDevices.has(d.id) || !staged}
              onPress={() => startSend({kind: 'device', id: d.id, label: d.label})}
            />
          ))
        )}

        {/* Contacts */}
        <Text style={styles.section}>Contacts</Text>
        {contacts.length === 0 ? (
          <Text style={styles.empty}>No contacts yet.</Text>
        ) : (
          contacts.map(c => (
            <Target
              key={c.user.id}
              title={contactName(c)}
              subtitle={c.user.email ?? 'contact'}
              online={onlineContacts.has(c.user.id)}
              disabled={busy || !onlineContacts.has(c.user.id) || !staged}
              onPress={() =>
                startSend({kind: 'contact', id: c.user.id, label: contactName(c)})
              }
            />
          ))
        )}

        <TouchableOpacity style={styles.btnGhost} onPress={onLogout}>
          <Text style={styles.btnGhostText}>Unlink this device</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function StatusBar({status}: {status: Status}): React.JSX.Element {
  let text = '';
  let pct: number | null = null;
  let action: (() => void) | null = null;
  let actionLabel = '';
  switch (status.kind) {
    case 'calling':
      text = `Connecting to ${status.label}…`;
      break;
    case 'sending':
      text = `Sending to ${status.label}`;
      pct = status.pct;
      break;
    case 'receiving':
      text = `Receiving “${status.name}”`;
      pct = status.pct;
      break;
    case 'done':
      text = status.text;
      if (status.shareUrl) {
        action = () => void Share.share({url: status.shareUrl!}).catch(() => {});
        actionLabel = 'Share';
      }
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
        <TouchableOpacity style={styles.shareBtn} onPress={action}>
          <Text style={styles.btnGhostText}>{actionLabel}</Text>
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
  content: {padding: 20, gap: 12},
  brand: {color: theme.text, fontSize: 24, fontWeight: '800'},
  sub: {color: theme.sub, fontSize: 14},
  headerRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start'},
  presencePill: {flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6},
  presenceText: {color: theme.sub, fontSize: 13},
  dot: {width: 9, height: 9, borderRadius: 5},

  card: {backgroundColor: theme.card, borderRadius: 14, padding: 18, marginTop: 10},
  cardTitle: {color: theme.sub, fontSize: 13, textTransform: 'uppercase', letterSpacing: 1},
  code: {
    color: theme.text,
    fontSize: 44,
    fontWeight: '800',
    letterSpacing: 8,
    textAlign: 'center',
    marginVertical: 14,
  },
  hint: {color: theme.faint, fontSize: 13, lineHeight: 18},
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

  section: {color: theme.sub, fontSize: 13, marginTop: 16, marginBottom: 2, fontWeight: '700'},
  empty: {color: theme.faint, fontSize: 14},

  targetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: theme.card,
    borderRadius: 12,
    padding: 14,
  },
  targetTitle: {color: theme.text, fontSize: 16, fontWeight: '600'},
  targetSub: {color: theme.sub, fontSize: 13, marginTop: 2},
  sendChip: {backgroundColor: theme.accent, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8},
  sendChipDisabled: {opacity: 0.35},
  sendChipText: {color: theme.text, fontWeight: '700', fontSize: 14},

  statusCard: {backgroundColor: theme.card, borderRadius: 12, padding: 14, gap: 10},
  statusFail: {borderWidth: 1, borderColor: theme.danger},
  statusText: {color: theme.text, fontSize: 14},
  progressTrack: {height: 6, backgroundColor: theme.cardAlt, borderRadius: 3, overflow: 'hidden'},
  progressFill: {height: 6, backgroundColor: theme.accent},
  shareBtn: {alignSelf: 'flex-start'},

  btnGhost: {
    marginTop: 20,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center',
  },
  btnGhostText: {color: theme.accent, fontWeight: '600', fontSize: 15},
});
