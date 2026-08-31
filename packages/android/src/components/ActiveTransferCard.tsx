import React from 'react';
import {Share, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {theme, radius} from '../theme';
import {useApp} from '../state/AppState';
import {ProgressBar, GhostButton} from '../ui/kit';
import {formatBytes, formatSpeed} from '../ui/format';
import {ShareIcon} from '../ui/icons';

// Sticky card describing the one live (or just-finished) transfer. Rendered above
// the tab content so it's visible from any screen.
export function ActiveTransferCard(): React.JSX.Element | null {
  const {transfer, cancel, dismissTransfer} = useApp();
  if (!transfer) return null;

  const t = transfer;
  const pct = t.totalBytes ? t.doneBytes / t.totalBytes : t.totalFiles ? t.filesDone / t.totalFiles : 0;
  const active = t.phase === 'connecting' || t.phase === 'active';

  let heading = '';
  if (t.phase === 'connecting') heading = t.direction === 'send' ? `Connecting to ${t.label}…` : 'Connecting…';
  else if (t.phase === 'active')
    heading = t.folder
      ? `${t.direction === 'send' ? 'Sending' : 'Receiving'} folder “${t.folder}”`
      : `${t.direction === 'send' ? 'Sending' : 'Receiving'} “${t.name}”`;
  else if (t.phase === 'done') heading = t.direction === 'send' ? `Sent “${t.name}”` : `Received “${t.name}”`;
  else heading = t.error ?? 'Transfer failed';

  const failed = t.phase === 'failed';
  const done = t.phase === 'done';

  return (
    <View style={[styles.card, failed && styles.failed, done && styles.done]}>
      <View style={styles.headRow}>
        <Text style={styles.heading} numberOfLines={1}>
          {heading}
        </Text>
        {t.connection && active && (
          <View style={[styles.badge, {borderColor: t.connection === 'relay' ? theme.warn : theme.online}]}>
            <Text style={[styles.badgeText, {color: t.connection === 'relay' ? theme.warn : theme.online}]}>
              {t.connection === 'relay' ? 'Relayed' : t.connection === 'direct' ? 'Direct' : '…'}
            </Text>
          </View>
        )}
      </View>

      {active && (
        <>
          <ProgressBar pct={pct} />
          <View style={styles.metaRow}>
            <Text style={styles.meta}>
              {t.totalFiles > 1 ? `File ${Math.min(t.filesDone + 1, t.totalFiles)}/${t.totalFiles} · ` : ''}
              {t.totalBytes ? `${formatBytes(t.doneBytes)} / ${formatBytes(t.totalBytes)}` : ''}
            </Text>
            <Text style={styles.meta}>{formatSpeed(t.speed)}</Text>
          </View>
          <GhostButton title="Cancel" onPress={cancel} danger style={{marginTop: 10}} />
        </>
      )}

      {done && (
        <View style={styles.doneRow}>
          {t.shareUrl && (
            <TouchableOpacity
              style={styles.shareBtn}
              onPress={() => void Share.share({url: t.shareUrl!}).catch(() => {})}>
              <ShareIcon color={theme.accent} />
              <Text style={styles.shareText}>Share</Text>
            </TouchableOpacity>
          )}
          <View style={{flex: 1}} />
          <TouchableOpacity onPress={dismissTransfer}>
            <Text style={styles.dismiss}>Dismiss</Text>
          </TouchableOpacity>
        </View>
      )}

      {failed && (
        <TouchableOpacity onPress={dismissTransfer} style={{marginTop: 8}}>
          <Text style={styles.dismiss}>Dismiss</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {backgroundColor: theme.elevated, borderRadius: radius.lg, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: theme.border},
  failed: {borderColor: theme.danger},
  done: {borderColor: theme.online},
  headRow: {flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10},
  heading: {color: theme.text, fontSize: 15, fontWeight: '600', flex: 1},
  badge: {borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3},
  badgeText: {fontSize: 11, fontWeight: '700'},
  metaRow: {flexDirection: 'row', justifyContent: 'space-between', marginTop: 8},
  meta: {color: theme.sub, fontSize: 12},
  doneRow: {flexDirection: 'row', alignItems: 'center', marginTop: 12},
  shareBtn: {flexDirection: 'row', alignItems: 'center', gap: 6},
  shareText: {color: theme.accent, fontWeight: '600', fontSize: 14},
  dismiss: {color: theme.sub, fontWeight: '600', fontSize: 14},
});
