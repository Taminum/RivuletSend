import React, {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {theme, radius} from '../theme';
import {api, type ApiTransfer} from '../net/api';
import {SectionTitle, Empty} from '../ui/kit';
import {formatBytes, shortDate} from '../ui/format';

export function HistoryScreen(): React.JSX.Element {
  const [transfers, setTransfers] = useState<ApiTransfer[] | null>(null);

  const load = useCallback(async () => {
    try {
      const {transfers: t} = await api.listTransfers();
      setTransfers(t);
    } catch {
      setTransfers([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (transfers === null) {
    return (
      <View style={{paddingVertical: 40, alignItems: 'center'}}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  return (
    <View>
      <View style={styles.head}>
        <SectionTitle>History</SectionTitle>
        <TouchableOpacity onPress={() => void load()}>
          <Text style={styles.refresh}>Refresh</Text>
        </TouchableOpacity>
      </View>
      {transfers.length === 0 ? (
        <Empty>No transfers yet.</Empty>
      ) : (
        transfers.map(t => (
          <View key={t.id} style={styles.row}>
            <View style={[styles.arrow, {backgroundColor: t.direction === 'sent' ? theme.accentDim : theme.online}]}>
              <Text style={styles.arrowText}>{t.direction === 'sent' ? '↑' : '↓'}</Text>
            </View>
            <View style={{flex: 1}}>
              <Text style={styles.name} numberOfLines={1}>
                {t.fileName}
              </Text>
              <Text style={styles.sub}>
                {formatBytes(Number(t.fileSize))} · {t.counterpart ? t.counterpart.displayName : t.direction === 'sent' ? 'by code' : 'unknown'} · {shortDate(t.createdAt)}
              </Text>
            </View>
            {t.status === 'failed' && <Text style={styles.failed}>failed</Text>}
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  head: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  refresh: {color: theme.accent, fontSize: 13, fontWeight: '600', marginTop: 14},
  row: {flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: theme.card, borderRadius: radius.md, padding: 14, marginBottom: 8},
  arrow: {width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center'},
  arrowText: {color: '#fff', fontWeight: '800', fontSize: 15},
  name: {color: theme.text, fontSize: 15, fontWeight: '600'},
  sub: {color: theme.sub, fontSize: 12, marginTop: 2},
  failed: {color: theme.danger, fontSize: 12, fontWeight: '700'},
});
