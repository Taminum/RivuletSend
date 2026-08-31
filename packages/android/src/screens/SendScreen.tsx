import React from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {theme, radius} from '../theme';
import {useApp, contactName} from '../state/AppState';
import {SectionTitle, Empty, Dot} from '../ui/kit';
import {formatBytes} from '../ui/format';
import {PlusIcon} from '../ui/icons';

export function SendScreen(): React.JSX.Element {
  const {
    staged,
    pickFiles,
    clearStaged,
    devices,
    onlineDevices,
    contacts,
    onlineContacts,
    sendToDevice,
    sendToContact,
    transfer,
  } = useApp();

  const busy = transfer?.phase === 'connecting' || transfer?.phase === 'active';
  const totalSize = staged.reduce((s, f) => s + f.size, 0);

  return (
    <View>
      <TouchableOpacity style={styles.pickBox} onPress={() => void pickFiles()} disabled={busy} activeOpacity={0.8}>
        {staged.length ? (
          <>
            <Text style={styles.pickName} numberOfLines={1}>
              {staged.length === 1 ? staged[0].name : `${staged.length} files selected`}
            </Text>
            <Text style={styles.pickSub}>{formatBytes(totalSize)} · tap to change</Text>
          </>
        ) : (
          <View style={styles.pickEmpty}>
            <PlusIcon color={theme.accent} />
            <Text style={styles.pickPrompt}>Pick file(s) to send</Text>
          </View>
        )}
      </TouchableOpacity>
      {staged.length > 0 && (
        <TouchableOpacity onPress={clearStaged} disabled={busy}>
          <Text style={styles.clear}>Clear selection</Text>
        </TouchableOpacity>
      )}

      <SectionTitle>Your devices</SectionTitle>
      {devices.length === 0 ? (
        <Empty>No other devices paired.</Empty>
      ) : (
        devices.map(d => (
          <TargetRow
            key={d.id}
            title={d.label}
            subtitle={d.platform ?? 'device'}
            online={onlineDevices.has(d.id)}
            disabled={busy || !onlineDevices.has(d.id) || !staged.length}
            onPress={() => sendToDevice(d.id, d.label)}
          />
        ))
      )}

      <SectionTitle>Contacts</SectionTitle>
      {contacts.length === 0 ? (
        <Empty>No contacts yet — add one in Settings.</Empty>
      ) : (
        contacts.map(c => (
          <TargetRow
            key={c.user.id}
            title={contactName(c)}
            subtitle={c.user.email ?? 'contact'}
            online={onlineContacts.has(c.user.id)}
            disabled={busy || !onlineContacts.has(c.user.id) || !staged.length}
            onPress={() => sendToContact(c.user.id, contactName(c))}
          />
        ))
      )}

      {!staged.length && (
        <Text style={styles.tip}>Pick a file first, then tap an online device or contact to send.</Text>
      )}
    </View>
  );
}

function TargetRow({
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
}) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} disabled={disabled} activeOpacity={0.8}>
      <Dot on={online} />
      <View style={{flex: 1}}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSub}>{online ? subtitle : `${subtitle} · offline`}</Text>
      </View>
      <View style={[styles.chip, disabled && {opacity: 0.35}]}>
        <Text style={styles.chipText}>Send</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  pickBox: {backgroundColor: theme.card, borderRadius: radius.lg, padding: 20, borderWidth: 1, borderColor: theme.border, borderStyle: 'dashed'},
  pickEmpty: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8},
  pickPrompt: {color: theme.accent, fontSize: 16, fontWeight: '600'},
  pickName: {color: theme.text, fontSize: 16, fontWeight: '600'},
  pickSub: {color: theme.sub, fontSize: 13, marginTop: 4},
  clear: {color: theme.sub, fontSize: 13, marginTop: 8, paddingVertical: 4},
  row: {flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: theme.card, borderRadius: radius.md, padding: 14, marginBottom: 8},
  rowTitle: {color: theme.text, fontSize: 16, fontWeight: '600'},
  rowSub: {color: theme.sub, fontSize: 13, marginTop: 2},
  chip: {backgroundColor: theme.accent, borderRadius: radius.sm, paddingHorizontal: 16, paddingVertical: 8},
  chipText: {color: '#fff', fontWeight: '700', fontSize: 14},
  tip: {color: theme.faint, fontSize: 13, marginTop: 16, textAlign: 'center'},
});
