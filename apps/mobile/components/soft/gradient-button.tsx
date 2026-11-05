import React from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useThemeTokens } from '../../hooks/use-theme-tokens';
import { usePressScale } from './use-press-scale';

const DESTRUCTIVE_FILL = '#B91C1C';

export type GradientButtonVariant = 'primary' | 'secondary' | 'destructive' | 'ghost';

export interface GradientButtonProps {
  label: string;
  onPress?: () => void;
  variant?: GradientButtonVariant;
  icon?: React.ReactNode;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function GradientButton({
  label,
  onPress,
  variant = 'primary',
  icon,
  disabled = false,
  loading = false,
  fullWidth = false,
  accessibilityLabel,
  testID,
  style,
}: GradientButtonProps) {
  const { soft } = useThemeTokens();
  const { scaleStyle, onPressIn, onPressOut } = usePressScale();
  const inactive = disabled || loading;

  const surface: ViewStyle = (() => {
    if (variant === 'primary') {
      return {
        backgroundColor: soft.accentStrong,
        experimental_backgroundImage: soft.enabled
          ? `linear-gradient(135deg, ${soft.accentGradient[0]}, ${soft.accentGradient[1]})`
          : undefined,
        ...soft.accentShadow,
      } as ViewStyle;
    }
    if (variant === 'destructive') {
      return { backgroundColor: DESTRUCTIVE_FILL };
    }
    if (variant === 'secondary') {
      return {
        backgroundColor: soft.surface,
        borderWidth: 1,
        borderColor: soft.border,
        ...soft.raised('sm'),
      } as ViewStyle;
    }
    return { backgroundColor: 'transparent' };
  })();

  const labelColor =
    variant === 'primary' ? soft.accentForeground
    : variant === 'destructive' ? '#FFFFFF'
    : variant === 'secondary' ? soft.foreground
    : soft.accentText;

  return (
    <Animated.View style={[scaleStyle, fullWidth ? styles.fullWidth : null]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityState={{ disabled: inactive, busy: loading }}
        disabled={inactive}
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        testID={testID}
        style={({ pressed }) => [
          styles.base,
          { borderRadius: soft.radius.control },
          surface,
          pressed && variant === 'ghost' ? { backgroundColor: soft.accentSoft } : null,
          inactive ? styles.disabled : null,
          style,
        ]}
      >
        {loading ? (
          <ActivityIndicator color={labelColor} />
        ) : (
          <View style={styles.content}>
            {icon}
            <Text allowFontScaling style={[styles.label, { color: labelColor }]} numberOfLines={1}>
              {label}
            </Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 44,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullWidth: { alignSelf: 'stretch' },
  content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  label: { fontSize: 15, fontWeight: '600' },
  disabled: { opacity: 0.5 },
});
