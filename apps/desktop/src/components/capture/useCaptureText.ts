import { useCallback } from 'react';
import { tFallback } from '@stride/core';

import { useLanguage } from '../../contexts/language-context';

export type CaptureText = (key: string, fallback: string, values?: Record<string, string | number>) => string;

/** `t(key, fallback, values)`: English fallback when a key is missing, `{{name}}` interpolation. */
export function useCaptureText(): CaptureText {
    const { t } = useLanguage();
    return useCallback<CaptureText>((key, fallback, values) => {
        let text = tFallback(t, key, fallback);
        if (values) {
            for (const [name, value] of Object.entries(values)) text = text.split(`{{${name}}}`).join(String(value));
        }
        return text;
    }, [t]);
}
