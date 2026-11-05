import { useCallback } from 'react';
import { translateWithFallback } from '@stride/core';
import { useLanguage } from '../../contexts/language-context';

export type FocusText = (key: string, fallback: string) => string;

export function useFocusText(): FocusText {
  const { t } = useLanguage();
  return useCallback((key: string, fallback: string) => translateWithFallback(t, key, fallback), [t]);
}
