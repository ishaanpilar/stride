import {
    createAIProvider,
    generateFocusCoach,
    generateFocusCoachReply,
    generateFocusEncouragement,
    isAIKeyRequired,
    useTaskStore,
    type FocusCoach,
    type FocusCoachInput,
    type FocusCoachReply,
    type FocusCoachTurn,
    type FocusEncouragementInput,
    type FocusTranslate,
    type Language,
} from '@stride/core';
import { buildAIConfig, loadAIKey } from './ai-config';
import { logWarn } from './app-log';

export const isFocusAiEnabled = (): boolean => useTaskStore.getState().settings.ai?.enabled === true;

async function getProvider(language: Language, timeoutMs: number) {
    const { settings } = useTaskStore.getState();
    if (settings.ai?.enabled !== true) return null;
    const providerId = settings.ai?.provider ?? 'openai';
    const apiKey = await loadAIKey(providerId);
    if (!apiKey && isAIKeyRequired(settings)) return null;
    const config = await buildAIConfig(settings, apiKey, language);
    return createAIProvider({ ...config, timeoutMs });
}

const safeProvider = async (language: Language, timeoutMs: number) => {
    try {
        return await getProvider(language, timeoutMs);
    } catch (error) {
        void logWarn('Focus coach provider unavailable', { scope: 'ai', extra: { error: error instanceof Error ? error.name : 'unknown' } });
        return null;
    }
};

const coachCache = new Map<string, FocusCoach>();

export async function requestFocusCoach(
    cacheKey: string,
    input: FocusCoachInput,
    options: { language?: Language; tr?: FocusTranslate; seed?: number } = {},
): Promise<FocusCoach> {
    const cached = coachCache.get(cacheKey);
    if (cached) return cached;
    const provider = await safeProvider(options.language ?? 'en', 8_000);
    const coach = await generateFocusCoach(provider, input, { tr: options.tr, seed: options.seed });
    if (coach.source === 'ai') coachCache.set(cacheKey, coach);
    return coach;
}

export async function requestFocusCoachReply(
    input: FocusCoachInput,
    turns: readonly FocusCoachTurn[],
    options: { language?: Language; tr?: FocusTranslate; now?: Date } = {},
): Promise<FocusCoachReply> {
    const provider = await safeProvider(options.language ?? 'en', 6_000);
    return generateFocusCoachReply(provider, input, turns, { now: options.now ?? new Date(), tr: options.tr });
}

const encouragementCache = new Map<string, string>();

export async function requestFocusEncouragement(
    cacheKey: string,
    input: FocusEncouragementInput,
    language: Language = 'en',
): Promise<string | null> {
    const cached = encouragementCache.get(cacheKey);
    if (cached) return cached;
    try {
        const provider = await getProvider(language, 6_000);
        const line = provider ? await generateFocusEncouragement(provider, input) : null;
        if (line) encouragementCache.set(cacheKey, line);
        return line;
    } catch {
        return null;
    }
}

export const resetFocusAiCacheForTests = () => {
    encouragementCache.clear();
    coachCache.clear();
};
