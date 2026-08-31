import React from 'react';
import {ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View} from 'react-native';
import {theme, radius} from '../theme';

export function Card({children, style}: {children: React.ReactNode; style?: any}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({children, style}: {children: React.ReactNode; style?: any}) {
  return <Text style={[styles.section, style]}>{children}</Text>;
}

export function PrimaryButton({
  title,
  onPress,
  disabled,
  busy,
  style,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  style?: any;
}) {
  return (
    <TouchableOpacity
      style={[styles.primary, (disabled || busy) && styles.disabled, style]}
      onPress={onPress}
      disabled={disabled || busy}
      activeOpacity={0.85}>
      {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{title}</Text>}
    </TouchableOpacity>
  );
}

export function GhostButton({
  title,
  onPress,
  disabled,
  danger,
  style,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
  style?: any;
}) {
  return (
    <TouchableOpacity style={[styles.ghost, style]} onPress={onPress} disabled={disabled} activeOpacity={0.7}>
      <Text style={[styles.ghostText, danger && {color: theme.danger}, disabled && {opacity: 0.5}]}>{title}</Text>
    </TouchableOpacity>
  );
}

export function Field(props: React.ComponentProps<typeof TextInput>) {
  return <TextInput placeholderTextColor={theme.faint} {...props} style={[styles.input, props.style]} />;
}

export function ProgressBar({pct}: {pct: number}) {
  return (
    <View style={styles.track}>
      <View style={[styles.fill, {width: `${Math.max(0, Math.min(100, Math.round(pct * 100)))}%`}]} />
    </View>
  );
}

export function Dot({on}: {on: boolean}) {
  return <View style={[styles.dot, {backgroundColor: on ? theme.online : theme.faint}]} />;
}

export function Empty({children}: {children: React.ReactNode}) {
  return <Text style={styles.empty}>{children}</Text>;
}

const styles = StyleSheet.create({
  card: {backgroundColor: theme.card, borderRadius: radius.lg, padding: 16},
  section: {color: theme.sub, fontSize: 12, letterSpacing: 0.5, textTransform: 'uppercase', fontWeight: '700', marginTop: 18, marginBottom: 8},
  primary: {backgroundColor: theme.accent, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', justifyContent: 'center'},
  primaryText: {color: '#fff', fontWeight: '700', fontSize: 15},
  disabled: {opacity: 0.4},
  ghost: {paddingVertical: 12, borderRadius: radius.md, borderWidth: 1, borderColor: theme.border, alignItems: 'center'},
  ghostText: {color: theme.accent, fontWeight: '600', fontSize: 15},
  input: {backgroundColor: theme.elevated, color: theme.text, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15},
  track: {height: 8, backgroundColor: theme.cardAlt, borderRadius: 4, overflow: 'hidden'},
  fill: {height: 8, backgroundColor: theme.accent, borderRadius: 4},
  dot: {width: 9, height: 9, borderRadius: 5},
  empty: {color: theme.faint, fontSize: 14, paddingVertical: 6},
});
