import React from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {theme} from '../theme';
import {SendIcon, DownloadIcon, HistoryIcon, SettingsIcon} from '../ui/icons';

export type Tab = 'send' | 'receive' | 'history' | 'settings';

const TABS: {key: Tab; label: string; Icon: React.ComponentType<{size?: number; color: string}>}[] = [
  {key: 'send', label: 'Send', Icon: SendIcon},
  {key: 'receive', label: 'Receive', Icon: DownloadIcon},
  {key: 'history', label: 'History', Icon: HistoryIcon},
  {key: 'settings', label: 'Settings', Icon: SettingsIcon},
];

export function TabBar({tab, onChange}: {tab: Tab; onChange: (t: Tab) => void}): React.JSX.Element {
  return (
    <View style={styles.bar}>
      {TABS.map(({key, label, Icon}) => {
        const active = tab === key;
        const color = active ? theme.accent : theme.faint;
        return (
          <TouchableOpacity key={key} style={styles.item} onPress={() => onChange(key)} activeOpacity={0.7}>
            <Icon size={22} color={color} />
            <Text style={[styles.label, {color}]}>{label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: theme.cardAlt,
    borderTopWidth: 1,
    borderTopColor: theme.border,
    paddingTop: 8,
    paddingBottom: 10,
  },
  item: {flex: 1, alignItems: 'center', gap: 3},
  label: {fontSize: 11, fontWeight: '600'},
});
