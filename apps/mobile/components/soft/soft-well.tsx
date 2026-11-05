import React from 'react';
import { View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { useThemeTokens } from '../../hooks/use-theme-tokens';

export interface SoftWellProps extends ViewProps {
  padded?: boolean;
  radius?: 'control' | 'card';
  style?: StyleProp<ViewStyle>;
}

export function useSoftWellStyle(radius: 'control' | 'card' = 'control', padded = false): ViewStyle {
  const { soft } = useThemeTokens();
  return {
    backgroundColor: soft.well,
    borderRadius: soft.radius[radius],
    borderTopWidth: soft.enabled ? 2 : 1,
    borderLeftWidth: soft.enabled ? 1 : 1,
    borderBottomWidth: soft.enabled ? 0 : 1,
    borderRightWidth: soft.enabled ? 0 : 1,
    borderTopColor: soft.enabled ? soft.wellEdge : soft.border,
    borderLeftColor: soft.enabled ? soft.wellEdge : soft.border,
    borderBottomColor: soft.border,
    borderRightColor: soft.border,
    padding: padded ? 12 : 0,
  };
}

export function SoftWell({ padded = false, radius = 'control', style, children, ...rest }: SoftWellProps) {
  const wellStyle = useSoftWellStyle(radius, padded);
  return (
    <View {...rest} style={[wellStyle, style]}>
      {children}
    </View>
  );
}
