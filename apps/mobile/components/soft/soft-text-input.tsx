import React, { forwardRef, useState } from 'react';
import { StyleSheet, TextInput, View, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle } from 'react-native';
import { useThemeTokens } from '../../hooks/use-theme-tokens';
import { useSoftWellStyle } from './soft-well';

export interface SoftTextInputProps extends TextInputProps {
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
  multilineMinHeight?: number;
}

export const SoftTextInput = forwardRef<TextInput, SoftTextInputProps>(function SoftTextInput(
  { leading, trailing, containerStyle, inputStyle, multilineMinHeight, onFocus, onBlur, style, multiline, ...rest },
  ref,
) {
  const { soft } = useThemeTokens();
  const wellStyle = useSoftWellStyle('control');
  const [focused, setFocused] = useState(false);

  return (
    <View
      style={[
        styles.container,
        wellStyle,
        multiline ? { minHeight: multilineMinHeight ?? 96, alignItems: 'flex-start' } : null,
        focused ? { borderColor: soft.accent, borderWidth: 2 } : null,
        containerStyle,
      ]}
    >
      {leading}
      <TextInput
        ref={ref}
        multiline={multiline}
        placeholderTextColor={soft.tertiary}
        selectionColor={soft.accent}
        {...rest}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        style={[styles.input, { color: soft.foreground }, inputStyle, style]}
      />
      {trailing}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 8,
  },
  input: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 10,
  },
});
