import React, {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, SafeAreaView, ScrollView, StyleSheet, Text, View} from 'react-native';
import {theme} from './src/theme';
import {loadToken, setToken, ApiError} from './src/net/session';
import {api, type ApiUser} from './src/net/api';
import {AppProvider, useApp} from './src/state/AppState';
import {PairScreen} from './src/screens/PairScreen';
import {SendScreen} from './src/screens/SendScreen';
import {ReceiveScreen} from './src/screens/ReceiveScreen';
import {HistoryScreen} from './src/screens/HistoryScreen';
import {SettingsScreen} from './src/screens/SettingsScreen';
import {TabBar, type Tab} from './src/components/TabBar';
import {ActiveTransferCard} from './src/components/ActiveTransferCard';
import {QrScanner} from './src/qr/Scanner';

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

  if (screen === 'loading') {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color={theme.accent} size="large" />
      </SafeAreaView>
    );
  }
  if (screen === 'pair' || !user) {
    return (
      <PairScreen
        onPaired={u => {
          setUser(u);
          setScreen('home');
        }}
      />
    );
  }
  return (
    <AppProvider user={user} onLoggedOut={() => setScreen('pair')}>
      <MainShell />
    </AppProvider>
  );
}

function MainShell(): React.JSX.Element {
  const {user, presenceUp, joinCode} = useApp();
  const [tab, setTab] = useState<Tab>('send');
  const [scanning, setScanning] = useState(false);

  const onScanned = useCallback(
    (value: string) => {
      setScanning(false);
      joinCode(value);
      setTab('receive');
    },
    [joinCode],
  );

  if (scanning) {
    return <QrScanner onScan={onScanned} onClose={() => setScanning(false)} />;
  }

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <View>
          <Text style={styles.brand}>OwlSend</Text>
          <Text style={styles.who}>{user.displayName}</Text>
        </View>
        <View style={styles.presence}>
          <View style={[styles.dot, {backgroundColor: presenceUp ? theme.online : theme.faint}]} />
          <Text style={styles.presenceText}>{presenceUp ? 'Online' : 'Connecting…'}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ActiveTransferCard />
        {tab === 'send' && <SendScreen />}
        {tab === 'receive' && <ReceiveScreen onScan={() => setScanning(true)} />}
        {tab === 'history' && <HistoryScreen />}
        {tab === 'settings' && <SettingsScreen />}
      </ScrollView>

      <TabBar tab={tab} onChange={setTab} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: theme.bg},
  center: {flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center'},
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 12,
  },
  brand: {color: theme.text, fontSize: 22, fontWeight: '800'},
  who: {color: theme.sub, fontSize: 13, marginTop: 2},
  presence: {flexDirection: 'row', alignItems: 'center', gap: 6},
  presenceText: {color: theme.sub, fontSize: 13},
  dot: {width: 9, height: 9, borderRadius: 5},
  content: {paddingHorizontal: 20, paddingTop: 4, paddingBottom: 30},
});
