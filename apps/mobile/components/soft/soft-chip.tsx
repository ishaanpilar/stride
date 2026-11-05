import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useThemeTokens } from '../../hooks/use-theme-tokens';
import type { SoftTone } from '../../constants/soft-ui';

export interface SoftChipProps {
  label: string;
  tone?: SoftTone;
  dotColor?: string;
  icon?: React.ReactNode;
  selected?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function SoftChip({
  label,
  tone = 'neutral',
  dotColor,
  icon,
  selected = false,
  onPress,
  accessibilityLabel,
  testID,
  style,
}: SoftChipProps) {
  const { soft } = useThemeTokens();
  const effectiveTone = selected ? soft.tones.accent : soft.tones[tone];
  const body = (
    <View
      style={[
        styles.chip,
        { backgroundColor: effectiveTone.background, borderRadius: soft.radius.pill },
        onPress ? styles.interactive : null,
        style,
      ]}
    >
      {dotColor ? <View style={[styles.dot, { backgroundColor: dotColor }]} /> : null}
      {icon}
      <Text allowFontScaling numberOfLines={1} style={[styles.label, { color: effectiveTone.foreground }]}>
        {label}
      </Text>
    </View>
  );

  if (!onPress) {
    return (
      <View accessible accessibilityLabel={accessibilityLabel ?? label} testID={testID}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected }}
      hitSlop={{ top: 9, bottom: 9, left: 4, right: 4 }}
      onPress={onPress}
      testID={testID}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 26,
    paddingHorizontal: 10,
    paddingVertical: 3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
  },
  interactive: { minHeight: 28 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  label: { fontSize: 12, fontWeight: '500' },
});
