import React from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeTokens } from '../../hooks/use-theme-tokens';

export interface SoftIconButtonProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  accessibilityLabel: string;
  onPress?: () => void;
  variant?: 'soft' | 'ghost';
  size?: number;
  disabled?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function SoftIconButton({
  icon,
  accessibilityLabel,
  onPress,
  variant = 'soft',
  size = 20,
  disabled = false,
  testID,
  style,
}: SoftIconButtonProps) {
  const { soft } = useThemeTokens();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.base,
        { borderRadius: soft.radius.control },
        variant === 'soft'
          ? ({ backgroundColor: soft.surface, ...soft.raised('sm') } as ViewStyle)
          : null,
        pressed ? { backgroundColor: soft.accentSoft } : null,
        disabled ? styles.disabled : null,
        style,
      ]}
    >
      <Ionicons name={icon} size={size} color={soft.foreground} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.5 },
});
