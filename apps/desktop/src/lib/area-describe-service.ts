import {
    AREA_DESCRIBE_TIMEOUT_MS,
    buildFallbackAreaDescription,
    createAIProvider,
    describeAreaWithAI,
    isAIKeyRequired,
    useTaskStore,
    type AreaDescribeResult,
    type Language,
} from '@stride/core';
import { buildAIConfig, loadAIKey } from './ai-config';
import { consumeAiUsage } from './ai-usage';
import { logWarn } from './app-log';

/**
 * "Describe with AI" for the area editor. Never throws: with AI off, no key, a timeout or bad
 * output, the paragraph itself becomes the description (source "fallback").
 */
export async function describeArea(areaName: string, text: string, language: Language = 'en'): Promise<AreaDescribeResult> {
    const { settings, people } = useTaskStore.getState();
    const knownPeople = people.filter((p) => !p.deletedAt).map((p) => p.name);
    try {
        if (settings.ai?.enabled !== true) return buildFallbackAreaDescription(text);
        const providerId = settings.ai?.provider ?? 'openai';
        const apiKey = await loadAIKey(providerId);
        if (!apiKey && isAIKeyRequired(settings)) return buildFallbackAreaDescription(text);
        if (!consumeAiUsage('area').allowed) return buildFallbackAreaDescription(text);
        const config = await buildAIConfig(settings, apiKey, language);
        const provider = createAIProvider({ ...config, timeoutMs: AREA_DESCRIBE_TIMEOUT_MS });
        return await describeAreaWithAI(provider, { areaName, text, knownPeople }, { timeoutMs: AREA_DESCRIBE_TIMEOUT_MS });
    } catch (error) {
        void logWarn('Area description generation failed', { scope: 'ai', extra: { error: error instanceof Error ? error.name : 'unknown' } });
        return buildFallbackAreaDescription(text);
    }
}
