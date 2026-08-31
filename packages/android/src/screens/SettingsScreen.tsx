import React, {useState} from 'react';
import {Alert, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {theme, radius} from '../theme';
import {useApp, contactName} from '../state/AppState';
import {Card, SectionTitle, PrimaryButton, GhostButton, Field, Empty, Dot} from '../ui/kit';

export function SettingsScreen(): React.JSX.Element {
  const {
    user,
    devices,
    onlineDevices,
    contacts,
    incoming,
    onlineContacts,
    addContact,
    acceptContact,
    removeContact,
    renameDevice,
    unlinkDevice,
    received,
    clearReceivedList,
    logout,
  } = useApp();

  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');

  const run = async (fn: () => Promise<void>, errMsg: string) => {
    setBusy(true);
    try {
      await fn();
    } catch {
      Alert.alert('OwlSend', errMsg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <Card>
        <Text style={styles.name}>{user.displayName}</Text>
        {user.email && <Text style={styles.sub}>{user.email}</Text>}
      </Card>

      {incoming.length > 0 && (
        <>
          <SectionTitle>Contact requests</SectionTitle>
          {incoming.map(c => (
            <View key={c.user.id} style={styles.row}>
              <View style={{flex: 1}}>
                <Text style={styles.rowTitle}>{contactName(c)}</Text>
                <Text style={styles.rowSub}>{c.user.email ?? 'wants to connect'}</Text>
              </View>
              <PrimaryButton
                title="Accept"
                onPress={() => void run(() => acceptContact(c.user.id), 'Could not accept')}
                busy={busy}
                style={{paddingHorizontal: 16, paddingVertical: 8}}
              />
            </View>
          ))}
        </>
      )}

      <SectionTitle>Add a contact</SectionTitle>
      <View style={styles.joinRow}>
        <Field
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          placeholder="their@email.com"
          style={{flex: 1}}
        />
        <PrimaryButton
          title="Add"
          onPress={() =>
            void run(async () => {
              await addContact(email);
              setEmail('');
            }, 'Could not add contact')
          }
          disabled={!email.trim()}
          busy={busy}
          style={{paddingHorizontal: 20}}
        />
      </View>

      <SectionTitle>Your contacts</SectionTitle>
      {contacts.length === 0 ? (
        <Empty>No contacts yet.</Empty>
      ) : (
        contacts.map(c => (
          <View key={c.user.id} style={styles.row}>
            <Dot on={onlineContacts.has(c.user.id)} />
            <View style={{flex: 1}}>
              <Text style={styles.rowTitle}>{contactName(c)}</Text>
              <Text style={styles.rowSub}>{c.user.email ?? 'contact'}</Text>
            </View>
            <TouchableOpacity
              onPress={() =>
                Alert.alert('Remove contact', `Remove ${contactName(c)}?`, [
                  {text: 'Cancel', style: 'cancel'},
                  {text: 'Remove', style: 'destructive', onPress: () => void run(() => removeContact(c.user.id), 'Could not remove')},
                ])
              }>
              <Text style={styles.remove}>Remove</Text>
            </TouchableOpacity>
          </View>
        ))
      )}

      <SectionTitle>Your devices</SectionTitle>
      {devices.length === 0 ? (
        <Empty>No other devices paired.</Empty>
      ) : (
        devices.map(d => (
          <View key={d.id} style={styles.deviceCard}>
            <View style={styles.row2}>
              <Dot on={onlineDevices.has(d.id)} />
              <View style={{flex: 1}}>
                {editId === d.id ? (
                  <Field value={editLabel} onChangeText={setEditLabel} autoFocus />
                ) : (
                  <Text style={styles.rowTitle}>{d.label}</Text>
                )}
                <Text style={styles.rowSub}>{d.platform ?? 'device'}</Text>
              </View>
            </View>
            <View style={styles.deviceActions}>
              {editId === d.id ? (
                <>
                  <TouchableOpacity
                    onPress={() =>
                      void run(async () => {
                        await renameDevice(d.id, editLabel.trim() || d.label);
                        setEditId(null);
                      }, 'Could not rename')
                    }>
                    <Text style={styles.action}>Save</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setEditId(null)}>
                    <Text style={styles.actionMuted}>Cancel</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <TouchableOpacity
                    onPress={() => {
                      setEditId(d.id);
                      setEditLabel(d.label);
                    }}>
                    <Text style={styles.action}>Rename</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() =>
                      Alert.alert('Unlink device', `Unlink ${d.label}?`, [
                        {text: 'Cancel', style: 'cancel'},
                        {text: 'Unlink', style: 'destructive', onPress: () => void run(() => unlinkDevice(d.id), 'Could not unlink')},
                      ])
                    }>
                    <Text style={[styles.action, {color: theme.danger}]}>Unlink</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        ))
      )}

      <SectionTitle>This device</SectionTitle>
      {received.length > 0 && (
        <GhostButton
          title={`Clear received list (${received.length})`}
          onPress={() =>
            Alert.alert('Clear list', 'This only clears the in-app list, not the files.', [
              {text: 'Cancel', style: 'cancel'},
              {text: 'Clear', onPress: () => void clearReceivedList()},
            ])
          }
          style={{marginBottom: 10}}
        />
      )}
      <GhostButton
        title="Unlink this device"
        danger
        onPress={() =>
          Alert.alert('Unlink this device', 'You’ll need to pair again to use OwlSend here.', [
            {text: 'Cancel', style: 'cancel'},
            {text: 'Unlink', style: 'destructive', onPress: () => void logout()},
          ])
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  name: {color: theme.text, fontSize: 20, fontWeight: '700'},
  sub: {color: theme.sub, fontSize: 14, marginTop: 4},
  row: {flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: theme.card, borderRadius: radius.md, padding: 14, marginBottom: 8},
  row2: {flexDirection: 'row', alignItems: 'center', gap: 12},
  rowTitle: {color: theme.text, fontSize: 15, fontWeight: '600'},
  rowSub: {color: theme.sub, fontSize: 12, marginTop: 2},
  joinRow: {flexDirection: 'row', gap: 10, alignItems: 'center'},
  remove: {color: theme.danger, fontSize: 13, fontWeight: '600'},
  deviceCard: {backgroundColor: theme.card, borderRadius: radius.md, padding: 14, marginBottom: 8},
  deviceActions: {flexDirection: 'row', gap: 18, marginTop: 12, justifyContent: 'flex-end'},
  action: {color: theme.accent, fontSize: 14, fontWeight: '600'},
  actionMuted: {color: theme.sub, fontSize: 14, fontWeight: '600'},
});
