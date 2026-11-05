import React from 'react';
import { Animated, Pressable, View, type PressableProps, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { useThemeTokens } from '../../hooks/use-theme-tokens';
import type { SoftSurfaceSize } from '../../constants/soft-ui';
import { usePressScale } from './use-press-scale';

export interface SoftCardProps extends ViewProps {
  size?: SoftSurfaceSize;
  selected?: boolean;
  padded?: boolean;
  onPress?: PressableProps['onPress'];
  onLongPress?: PressableProps['onLongPress'];
  disabled?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export function useSoftCardStyle(size: SoftSurfaceSize, selected: boolean, padded: boolean): ViewStyle {
  const { soft, colors } = useThemeTokens();
  const radius = size === 'lg' ? soft.radius.sheet : soft.radius.card;
  return {
    backgroundColor: selected ? soft.accentSoft : soft.surface,
    borderRadius: radius,
    borderWidth: selected ? 1 : soft.enabled ? 0 : 1,
    borderColor: selected ? soft.accent : colors.border,
    padding: padded ? 16 : 0,
    ...soft.raised(size),
  } as ViewStyle;
}

export function SoftCard({
  size = 'sm',
  selected = false,
  padded = true,
  onPress,
  onLongPress,
  disabled,
  accessibilityLabel,
  style,
  children,
  ...rest
}: SoftCardProps) {
  const cardStyle = useSoftCardStyle(size, selected, padded);
  const { scaleStyle, onPressIn, onPressOut } = usePressScale();

  if (!onPress && !onLongPress) {
    return (
      <View {...rest} style={[cardStyle, style]}>
        {children}
      </View>
    );
  }

  return (
    <Animated.View style={scaleStyle}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ selected, disabled: Boolean(disabled) }}
        disabled={disabled}
        onPress={onPress}
        onLongPress={onLongPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        style={[cardStyle, style]}
        testID={rest.testID}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}
