import { Platform } from 'react-native';
import type { MarkdownSelection } from '@stride/core';

export function getControlledTextInputSelection(
  selection: MarkdownSelection,
  options?: { force?: boolean },
): MarkdownSelection | undefined {
  if (options?.force) return selection;

  return Platform.OS === 'android' ? undefined : selection;
}
