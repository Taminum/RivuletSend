import React, {useCallback, useEffect, useRef, useState} from 'react';
import {ActivityIndicator, SafeAreaView, ScrollView, StyleSheet, Text, View} from 'react-native';
import {theme, radius} from '../theme';
import {api, type ApiUser} from '../net/api';
import {setToken} from '../net/session';
import {Card, GhostButton} from '../ui/kit';

export function PairScreen({onPaired}: {onPaired: (u: ApiUser) => void}): React.JSX.Element {
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const requestCode = useCallback(async () => {
    setError(null);
    setCode(null);
    stop();
    try {
      const {code: c} = await api.pairingRequest({platform: 'android', label: 'Android phone'});
      setCode(c);
      pollRef.current = setInterval(async () => {
        try {
          const res = await api.pairingStatus(c);
          if (res.status === 'approved' && res.token && res.user) {
            stop();
            await setToken(res.token);
            onPaired(res.user);
          } else if (res.status === 'expired') {
            stop();
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
    return stop;
  }, [requestCode]);

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.brand}>OwlSend</Text>
        <Text style={styles.tagline}>Link this phone to your account</Text>
        <Card style={{alignItems: 'center', marginTop: 16}}>
          <Text style={styles.label}>Pairing code</Text>
          {code ? <Text style={styles.code}>{code}</Text> : <ActivityIndicator color={theme.accent} style={{marginVertical: 22}} />}
          <Text style={styles.hint}>
            On OwlSend web or desktop (signed in): Settings → “Link a new device” → enter this code. Expires in ~2 min.
          </Text>
        </Card>
        {error && <Text style={styles.error}>{error}</Text>}
        <GhostButton title="New code" onPress={requestCode} style={{marginTop: 16}} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: theme.bg},
  content: {padding: 20, paddingTop: 60},
  brand: {color: theme.text, fontSize: 30, fontWeight: '800'},
  tagline: {color: theme.sub, fontSize: 15, marginTop: 6},
  label: {color: theme.sub, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase'},
  code: {color: theme.text, fontSize: 46, fontWeight: '800', letterSpacing: 10, marginVertical: 14},
  hint: {color: theme.faint, fontSize: 13, lineHeight: 19, textAlign: 'center'},
  error: {color: theme.danger, fontSize: 14, marginTop: 12},
});
