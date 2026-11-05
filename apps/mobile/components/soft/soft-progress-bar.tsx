import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { useThemeTokens } from '../../hooks/use-theme-tokens';

export interface SoftProgressBarProps {
  value: number;
  max: number;
  accessibilityLabel: string;
  valueText?: string;
}

export function SoftProgressBar({ value, max, accessibilityLabel, valueText }: SoftProgressBarProps) {
  const { soft } = useThemeTokens();
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const fill: ViewStyle = {
    width: `${Math.round(ratio * 100)}%`,
    backgroundColor: soft.accentStrong,
    experimental_backgroundImage: soft.enabled
      ? `linear-gradient(90deg, ${soft.accentGradient[0]}, ${soft.accentGradient[1]})`
      : undefined,
  } as ViewStyle;
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max, now: Math.min(max, Math.max(0, value)), text: valueText }}
      style={[styles.track, { backgroundColor: soft.well }]}
    >
      <View style={[styles.fill, fill]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 6, borderRadius: 999, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 999 },
});
