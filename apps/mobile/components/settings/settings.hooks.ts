import { useMemo } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { resolveI18nText, type I18nTemplateValues } from '@stride/core';

import { useLanguage } from '@/contexts/language-context';

import { styles } from './settings.styles';

export function useSettingsLocalization() {
    const { language, t, setLanguage } = useLanguage();
    const isChineseLanguage = language === 'zh' || language === 'zh-Hant';
    const tr = useMemo(
        () => (key: string, values?: I18nTemplateValues) => resolveI18nText(t, key, { values }),
        [t],
    );

    return {
        isChineseLanguage,
        language,
        setLanguage,
        t,
        tr,
    };
}

export function useSettingsScrollContent(paddingBottom = 16) {
    const insets = useSafeAreaInsets();

    return useMemo(
        () => [styles.scrollContent, { paddingBottom: paddingBottom + insets.bottom }],
        [insets.bottom, paddingBottom],
    );
}
