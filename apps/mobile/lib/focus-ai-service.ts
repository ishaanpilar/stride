import {
    createAIProvider,
    createFocusAiService,
    isSandboxMode,
    useTaskStore,
    type Language,
} from '@stride/core';
import { buildAIConfig, isAIKeyRequired, loadAIKey } from './ai-config';
import { logWarn } from './app-log';

async function resolveProvider(language: Language, timeoutMs: number) {
    const { settings } = useTaskStore.getState();
    if (settings.ai?.enabled !== true || isSandboxMode()) return null;
    const providerId = settings.ai?.provider ?? 'openai';
    try {
        const apiKey = await loadAIKey(providerId);
        if (!apiKey && isAIKeyRequired(settings)) return null;
        return createAIProvider({ ...buildAIConfig(settings, apiKey, language), timeoutMs });
    } catch (error) {
        void logWarn('Focus coach provider unavailable', { scope: 'ai', extra: { error: error instanceof Error ? error.name : 'unknown' } });
        return null;
    }
}

export const focusAiService = createFocusAiService(resolveProvider);
