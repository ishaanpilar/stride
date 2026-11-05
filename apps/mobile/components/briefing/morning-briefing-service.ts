import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    DAILY_BRIEFING_CACHE_KEY,
    createAIProvider,
    generateDailyBriefing,
    isAIKeyRequired,
    isAIMorningBriefingEnabled,
    localDayKey,
    parseBriefingCache,
    serializeBriefingCache,
    useTaskStore,
    type DailyBriefing,
    type Language,
} from '@stride/core';

import { buildAIConfig, loadAIKey } from '@/lib/ai-config';

export const BRIEFING_DISMISS_KEY = 'stride:daily-briefing-dismissed:v1';
const BRIEFING_TIMEOUT_MS = 20_000;

let inFlight: Promise<DailyBriefing | null> | null = null;

export async function readCachedBriefing(now: Date = new Date()): Promise<DailyBriefing | null> {
    try {
        return parseBriefingCache(await AsyncStorage.getItem(DAILY_BRIEFING_CACHE_KEY), localDayKey(now))?.briefing ?? null;
    } catch {
        return null;
    }
}

export async function isBriefingDismissed(now: Date = new Date()): Promise<boolean> {
    try {
        return (await AsyncStorage.getItem(BRIEFING_DISMISS_KEY)) === localDayKey(now);
    } catch {
        return false;
    }
}

export async function setBriefingDismissed(dismissed: boolean, now: Date = new Date()): Promise<void> {
    try {
        if (dismissed) await AsyncStorage.setItem(BRIEFING_DISMISS_KEY, localDayKey(now));
        else await AsyncStorage.removeItem(BRIEFING_DISMISS_KEY);
    } catch {
        // best-effort
    }
}

/**
 * Today's AI briefing: cached for the day unless `force`, else generated through the configured
 * core provider with a hard timeout. Resolves null (never throws) when AI is off, keyless or fails,
 * so the card can show its non-AI summary.
 */
export function ensureBriefing(options: { force?: boolean; language?: Language; now?: Date } = {}): Promise<DailyBriefing | null> {
    const now = options.now ?? new Date();
    if (inFlight) return inFlight;
    inFlight = (async () => {
        try {
            if (!options.force) {
                const cached = await readCachedBriefing(now);
                if (cached) return cached;
            }
            const { settings, tasks, projects } = useTaskStore.getState();
            if (!isAIMorningBriefingEnabled(settings)) return null;
            const provider = settings.ai?.provider ?? 'openai';
            const apiKey = await loadAIKey(provider);
            if (!apiKey && isAIKeyRequired(settings)) return null;
            const config = buildAIConfig(settings, apiKey, options.language ?? 'en');
            const aiProvider = createAIProvider({ ...config, timeoutMs: Math.min(config.timeoutMs ?? BRIEFING_TIMEOUT_MS, BRIEFING_TIMEOUT_MS) });
            const briefing = await generateDailyBriefing({
                provider: aiProvider, tasks, projects, now, language: options.language, timeoutMs: BRIEFING_TIMEOUT_MS,
            });
            if (briefing) {
                try {
                    await AsyncStorage.setItem(DAILY_BRIEFING_CACHE_KEY, serializeBriefingCache(localDayKey(now), briefing, now));
                } catch {
                    // cache is best-effort
                }
            }
            return briefing;
        } catch {
            return null;
        } finally {
            inFlight = null;
        }
    })();
    return inFlight;
}

export function resetBriefingServiceForTests(): void {
    inFlight = null;
}
