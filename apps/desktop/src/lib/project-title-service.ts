import {
    PROJECT_TITLE_SHORTEN_TIMEOUT_MS,
    buildFallbackShortProjectTitle,
    createAIProvider,
    isAIKeyRequired,
    shortenProjectTitleWithAI,
    useTaskStore,
    type Language,
    type ShortenProjectTitleResult,
} from '@stride/core';
import { buildAIConfig, loadAIKey } from './ai-config';
import { logWarn } from './app-log';

/**
 * "Shorten" for a long project title. Never throws: with AI off, no key, an 8s timeout or bad
 * output, the title is trimmed to its first clause (source "fallback").
 */
export async function shortenProjectTitle(title: string, notes?: string, language: Language = 'en'): Promise<ShortenProjectTitleResult> {
    const { settings } = useTaskStore.getState();
    try {
        if (settings.ai?.enabled !== true) return buildFallbackShortProjectTitle(title);
        const providerId = settings.ai?.provider ?? 'openai';
        const apiKey = await loadAIKey(providerId);
        if (!apiKey && isAIKeyRequired(settings)) return buildFallbackShortProjectTitle(title);
        const config = await buildAIConfig(settings, apiKey, language);
        const provider = createAIProvider({ ...config, timeoutMs: PROJECT_TITLE_SHORTEN_TIMEOUT_MS });
        return await shortenProjectTitleWithAI(provider, { title, notes }, { timeoutMs: PROJECT_TITLE_SHORTEN_TIMEOUT_MS });
    } catch (error) {
        void logWarn('Project title shortening failed', { scope: 'ai', extra: { error: error instanceof Error ? error.name : 'unknown' } });
        return buildFallbackShortProjectTitle(title);
    }
}
