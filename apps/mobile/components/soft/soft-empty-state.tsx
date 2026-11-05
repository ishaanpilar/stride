import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useThemeTokens } from '../../hooks/use-theme-tokens';
import { GradientButton } from './gradient-button';

export interface SoftEmptyStateProps {
  title: string;
  hint?: string;
  icon?: React.ReactNode;
  actionLabel?: string;
  onAction?: () => void;
}

export function SoftEmptyState({ title, hint, icon, actionLabel, onAction }: SoftEmptyStateProps) {
  const { soft } = useThemeTokens();
  return (
    <View
      accessible
      accessibilityLabel={hint ? `${title}. ${hint}` : title}
      style={[styles.container, { backgroundColor: soft.well, borderRadius: soft.radius.card }]}
    >
      {icon}
      <Text accessibilityLiveRegion="polite" style={[styles.title, { color: soft.foreground }]}>{title}</Text>
      {hint ? <Text style={[styles.hint, { color: soft.muted }]}>{hint}</Text> : null}
      {actionLabel && onAction ? (
        <View style={styles.action}>
          <GradientButton label={actionLabel} onPress={onAction} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingVertical: 36, paddingHorizontal: 20, alignItems: 'center', gap: 8 },
  title: { fontSize: 17, fontWeight: '600', textAlign: 'center' },
  hint: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  action: { marginTop: 8 },
});
