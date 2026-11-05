import {
    createAIProvider,
    createFocusAiService,
    isAIKeyRequired,
    useTaskStore,
    type Language,
} from '@stride/core';
import { buildAIConfig, loadAIKey } from './ai-config';
import { consumeAiUsage } from './ai-usage';
import { logWarn } from './app-log';

export const isFocusAiEnabled = (): boolean => useTaskStore.getState().settings.ai?.enabled === true;

async function resolveProvider(language: Language, timeoutMs: number) {
    const { settings } = useTaskStore.getState();
    if (settings.ai?.enabled !== true) return null;
    const providerId = settings.ai?.provider ?? 'openai';
    try {
        const apiKey = await loadAIKey(providerId);
        if (!apiKey && isAIKeyRequired(settings)) return null;
        // Local usage guard: over the per-minute limit the coach uses its non-AI fallback.
        if (!consumeAiUsage('coach').allowed) return null;
        const config = await buildAIConfig(settings, apiKey, language);
        return createAIProvider({ ...config, timeoutMs });
    } catch (error) {
        void logWarn('Focus coach provider unavailable', { scope: 'ai', extra: { error: error instanceof Error ? error.name : 'unknown' } });
        return null;
    }
}

const service = createFocusAiService(resolveProvider);

export const requestFocusCoach = service.requestFocusCoach;
export const requestFocusCoachReply = service.requestFocusCoachReply;
export const requestFocusEncouragement = service.requestFocusEncouragement;
export const resetFocusAiCacheForTests = service.resetCaches;
