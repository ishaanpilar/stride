import { useCallback, useEffect, useState } from 'react';
import { ASSISTANT_DAILY_LIMIT_OPTIONS, getTranslationsSync, resolveI18nText, totalAIUsage } from '@stride/core';
import { useDocumentationLanguage } from '../../../contexts/language-context';
import { getAiUsageToday, getAssistantDailyLimit, setAssistantDailyLimit, subscribeAiUsage } from '../../../lib/ai-usage';
import { SettingRow } from './SettingRow';

const UNLIMITED = 'unlimited';

/** Settings → AI: today's AI request count on this device and the daily Assistant cap. */
export function AiUsageSection() {
    const language = useDocumentationLanguage();
    const tr = useCallback((key: string, values?: Record<string, string | number>) => {
        const dict = getTranslationsSync(language);
        return resolveI18nText((k) => dict[k] ?? k, key, values ? { values } : undefined);
    }, [language]);
    const [usage, setUsage] = useState(() => getAiUsageToday());
    const [limit, setLimit] = useState<number | null>(() => getAssistantDailyLimit());

    useEffect(() => subscribeAiUsage(() => {
        setUsage(getAiUsageToday());
        setLimit(getAssistantDailyLimit());
    }), []);

    const options = ASSISTANT_DAILY_LIMIT_OPTIONS.includes(limit) ? ASSISTANT_DAILY_LIMIT_OPTIONS : [...ASSISTANT_DAILY_LIMIT_OPTIONS, limit];

    return (
        <div className="border-t border-border p-4 space-y-3" data-testid="ai-usage-section">
            <div>
                <div className="text-sm font-medium">{tr('settings.aiUsageGuardTitle')}</div>
                <div className="text-[13px] text-muted-foreground mt-1" data-testid="ai-usage-today">
                    {tr('settings.aiUsageToday', { count: totalAIUsage(usage), assistant: usage.counts.assistant ?? 0 })}
                </div>
            </div>
            <SettingRow
                settingsKey={null}
                title={tr('settings.aiAssistantDailyLimit')}
                description={tr('settings.aiAssistantDailyLimitDesc')}
            >
                <select
                    aria-label={tr('settings.aiAssistantDailyLimit')}
                    value={limit === null ? UNLIMITED : String(limit)}
                    onChange={(event) => {
                        const next = event.target.value === UNLIMITED ? null : Number(event.target.value);
                        setAssistantDailyLimit(next);
                        setLimit(getAssistantDailyLimit());
                    }}
                    className="px-2 py-1 text-sm text-foreground bg-card border border-border shadow-soft-sm hover:bg-accent rounded-control focus-ring"
                >
                    {options.map((value) => (
                        <option key={value ?? UNLIMITED} value={value === null ? UNLIMITED : String(value)}>
                            {value === null ? tr('settings.aiLimitUnlimited') : tr('settings.aiLimitPerDay', { count: value })}
                        </option>
                    ))}
                </select>
            </SettingRow>
            <div className="text-xs text-muted-foreground">{tr('settings.aiUsageBurstNote')}</div>
        </div>
    );
}
