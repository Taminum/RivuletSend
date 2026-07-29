import React, {useRef, useState} from 'react';
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {BackpressureProbe, type ProbeStats} from './src/peer/backpressureProbe';

// Bytes to push in the probe. 64 MB is enough to blow past the 4 MB high-water
// mark many times and exercise the drain path repeatedly, without waiting all
// day. Bump it for a closer analogue of the multi-GB e2e fixture once the basics
// look right on a real device.
const PROBE_BYTES = 64 * 1024 * 1024;

const ACCENT = '#7c6df2';

// Step 1 harness: the whole point is to establish a react-native-webrtc data
// channel through the real signaling server and confirm the browser-tuned
// backpressure logic behaves the same here. No transfer UI yet — just the
// riskiest unknown, on a real device, first.
export default function App(): React.JSX.Element {
  const [signalingUrl, setSignalingUrl] = useState('wss://send.tarmalion.ru/ws');
  const [code, setCode] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [role, setRole] = useState<'sender' | 'receiver' | null>(null);
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState<ProbeStats | null>(null);
  const probeRef = useRef<BackpressureProbe | null>(null);

  const append = (line: string) => setLog((l) => [...l, line]);

  function makeProbe(): BackpressureProbe {
    const probe = new BackpressureProbe(signalingUrl);
    probe.onStatus = (m) => append(m);
    probe.onConnected = (r) => {
      setRole(r);
      append(`data channel open — role: ${r}`);
    };
    probe.onReceiveProgress = (bytes, mbps) =>
      setLog((l) => [
        ...l.filter((x) => !x.startsWith('recv ')),
        `recv ${(bytes / 1e6).toFixed(1)} MB  ${mbps.toFixed(1)} MB/s`,
      ]);
    probeRef.current = probe;
    return probe;
  }

  async function onCreate() {
    setBusy(true);
    setStats(null);
    try {
      const roomCode = await makeProbe().createRoom();
      setCode(roomCode);
      append(`room created: ${roomCode} — waiting for the other phone to join…`);
    } catch (e) {
      append(`create failed: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function onJoin() {
    if (!code.trim()) return;
    setBusy(true);
    setStats(null);
    try {
      await makeProbe().joinRoom(code.trim().toUpperCase());
      append('joined — negotiating…');
    } catch (e) {
      append(`join failed: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function onRunProbe() {
    const probe = probeRef.current;
    if (!probe) return;
    setBusy(true);
    append(`sending ${(PROBE_BYTES / 1e6).toFixed(0)} MB…`);
    try {
      const s = await probe.runProbe(PROBE_BYTES, (sent) => {
        setLog((l) => [
          ...l.filter((x) => !x.startsWith('sent ')),
          `sent ${(sent / 1e6).toFixed(1)} MB`,
        ]);
      });
      setStats(s);
      append('probe done');
    } catch (e) {
      append(`probe failed: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>RivuletSend — WebRTC probe</Text>
        <Text style={styles.sub}>
          Step 1: verify react-native-webrtc data channel + backpressure on a real device.
          Run two phones — one Creates, one Joins with the code.
        </Text>

        <Text style={styles.label}>Signaling URL</Text>
        <TextInput
          style={styles.input}
          value={signalingUrl}
          onChangeText={setSignalingUrl}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <View style={styles.row}>
          <Button title="Create room" onPress={onCreate} disabled={busy} />
        </View>

        <Text style={styles.label}>…or join with a code</Text>
        <View style={styles.row}>
          <TextInput
            style={[styles.input, styles.codeInput]}
            value={code}
            onChangeText={setCode}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="ABCD1234"
            placeholderTextColor="#666"
          />
          <Button title="Join" onPress={onJoin} disabled={busy} />
        </View>

        {role === 'sender' && (
          <View style={styles.row}>
            <Button title={`Send ${PROBE_BYTES / 1e6} MB probe`} onPress={onRunProbe} disabled={busy} />
          </View>
        )}

        {stats && (
          <View style={styles.stats}>
            <Text style={styles.statsTitle}>Result</Text>
            <Stat k="Throughput" v={`${stats.throughputMBs.toFixed(1)} MB/s`} />
            <Stat k="Sent" v={`${(stats.bytes / 1e6).toFixed(0)} MB in ${stats.seconds.toFixed(1)}s`} />
            <Stat k="Max buffered" v={`${(stats.maxBufferedAmount / 1e6).toFixed(2)} MB`} />
            <Stat k="Drain waits" v={String(stats.drainWaits)} />
            <Stat
              k="bufferedamountlow"
              v={stats.bufferedAmountLowSupported ? 'fires ✓' : 'UNRELIABLE ✗'}
            />
            <Stat k="Event timeouts" v={String(stats.drainEventTimeouts)} />
          </View>
        )}

        <Text style={styles.label}>Log</Text>
        <View style={styles.logBox}>
          {log.map((line, i) => (
            <Text key={i} style={styles.logLine}>
              {line}
            </Text>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Button({title, onPress, disabled}: {title: string; onPress: () => void; disabled?: boolean}) {
  return (
    <TouchableOpacity
      style={[styles.button, disabled && styles.buttonDisabled]}
      onPress={onPress}
      disabled={disabled}>
      <Text style={styles.buttonText}>{title}</Text>
    </TouchableOpacity>
  );
}

function Stat({k, v}: {k: string; v: string}) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statKey}>{k}</Text>
      <Text style={styles.statVal}>{v}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#121214'},
  content: {padding: 20, gap: 10},
  title: {color: '#fff', fontSize: 22, fontWeight: '700'},
  sub: {color: '#9a9aa2', fontSize: 13, marginBottom: 8},
  label: {color: '#c8c8d0', fontSize: 13, marginTop: 12},
  input: {
    backgroundColor: '#1c1c22',
    color: '#fff',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  codeInput: {flex: 1, marginRight: 10},
  row: {flexDirection: 'row', alignItems: 'center', marginTop: 8},
  button: {backgroundColor: ACCENT, borderRadius: 10, paddingVertical: 11, paddingHorizontal: 18},
  buttonDisabled: {opacity: 0.5},
  buttonText: {color: '#fff', fontWeight: '600', fontSize: 15},
  stats: {backgroundColor: '#1c1c22', borderRadius: 12, padding: 14, marginTop: 16, gap: 6},
  statsTitle: {color: '#fff', fontWeight: '700', fontSize: 15, marginBottom: 4},
  statRow: {flexDirection: 'row', justifyContent: 'space-between'},
  statKey: {color: '#9a9aa2', fontSize: 14},
  statVal: {color: '#fff', fontSize: 14, fontWeight: '600'},
  logBox: {backgroundColor: '#0d0d10', borderRadius: 10, padding: 12, marginTop: 6, minHeight: 80},
  logLine: {color: '#8a8a92', fontSize: 12, fontFamily: 'monospace'},
});
