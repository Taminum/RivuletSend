import React, {useState} from 'react';
import {Share, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import {theme, radius} from '../theme';
import {useApp} from '../state/AppState';
import {Card, SectionTitle, PrimaryButton, GhostButton, Field, Empty} from '../ui/kit';
import {formatBytes, timeAgo} from '../ui/format';
import {ShareIcon} from '../ui/icons';
import {codeToQrValue} from '../qr/format';

export function ReceiveScreen({onScan}: {onScan: () => void}): React.JSX.Element {
  const {roomCode, hostCode, joinCode, staged, received, transfer, cancel} = useApp();
  const [join, setJoin] = useState('');
  const busy = transfer?.phase === 'connecting' || transfer?.phase === 'active';

  return (
    <View>
      {roomCode ? (
        <Card style={{alignItems: 'center'}}>
          <Text style={styles.label}>Share this code</Text>
          <Text style={styles.code}>{roomCode}</Text>
          <View style={styles.qr}>
            <QRCode value={codeToQrValue(roomCode)} size={200} backgroundColor="white" color="black" />
          </View>
          <Text style={styles.hint}>
            {staged.length
              ? 'Join with this code (or scan) on the other device — your files send automatically once it connects.'
              : 'Join with this code (or scan) on the other device to send here.'}
          </Text>
          <GhostButton title="Cancel" onPress={cancel} danger style={{marginTop: 14, alignSelf: 'stretch'}} />
        </Card>
      ) : (
        <>
          <PrimaryButton
            title={staged.length ? 'Get a code to send' : 'Get a code to receive'}
            onPress={hostCode}
            disabled={busy}
          />

          <SectionTitle>Join a code</SectionTitle>
          <View style={styles.joinRow}>
            <Field
              value={join}
              onChangeText={setJoin}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="ABCD12"
              style={{flex: 1}}
            />
            <PrimaryButton
              title="Join"
              onPress={() => joinCode(join.trim())}
              disabled={busy || join.trim().length < 4}
              style={{paddingHorizontal: 22}}
            />
          </View>
          <GhostButton title="Scan a QR code" onPress={onScan} disabled={busy} style={{marginTop: 10}} />
        </>
      )}

      <SectionTitle>Received files</SectionTitle>
      {received.length === 0 ? (
        <Empty>Nothing received yet.</Empty>
      ) : (
        received.map(f => (
          <View key={f.id + f.at} style={styles.fileRow}>
            <View style={{flex: 1}}>
              <Text style={styles.fileName} numberOfLines={1}>
                {f.name}
              </Text>
              <Text style={styles.fileSub}>
                {formatBytes(f.size)} · {timeAgo(f.at)}
                {f.location.startsWith('content://') ? ' · Downloads' : ''}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.shareBtn}
              onPress={() => void Share.share({url: f.location}).catch(() => {})}>
              <ShareIcon color={theme.accent} />
            </TouchableOpacity>
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {color: theme.sub, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase'},
  code: {color: theme.text, fontSize: 40, fontWeight: '800', letterSpacing: 8, marginVertical: 10},
  qr: {backgroundColor: 'white', padding: 12, borderRadius: radius.md, marginBottom: 12},
  hint: {color: theme.faint, fontSize: 13, textAlign: 'center', lineHeight: 18},
  joinRow: {flexDirection: 'row', gap: 10, alignItems: 'center'},
  fileRow: {flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: theme.card, borderRadius: radius.md, padding: 14, marginBottom: 8},
  fileName: {color: theme.text, fontSize: 15, fontWeight: '600'},
  fileSub: {color: theme.sub, fontSize: 12, marginTop: 2},
  shareBtn: {padding: 8, borderRadius: radius.sm, backgroundColor: theme.elevated},
});
