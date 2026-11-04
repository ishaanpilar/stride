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
    type CachedDailyBriefing,
    type DailyBriefing,
    type Language,
} from '@stride/core';
import { buildAIConfig, loadAIKey } from './ai-config';
import { logWarn } from './app-log';

type Listener = () => void;

const listeners = new Set<Listener>();
let inFlight: Promise<DailyBriefing | null> | null = null;
let lastAttemptDay: string | null = null;

const notify = () => listeners.forEach((listener) => listener());

export function subscribeDailyBriefing(listener: Listener): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

export function readCachedDailyBriefing(now: Date = new Date()): CachedDailyBriefing | null {
    try {
        if (typeof localStorage === 'undefined') return null;
        return parseBriefingCache(localStorage.getItem(DAILY_BRIEFING_CACHE_KEY), localDayKey(now));
    } catch {
        return null;
    }
}

function writeCache(day: string, briefing: DailyBriefing): void {
    try {
        if (typeof localStorage === 'undefined') return;
        localStorage.setItem(DAILY_BRIEFING_CACHE_KEY, serializeBriefingCache(day, briefing));
    } catch {
        // cache is best-effort
    }
}

export function isDailyBriefingEnabled(): boolean {
    return isAIMorningBriefingEnabled(useTaskStore.getState().settings);
}

/** True if an automatic attempt already ran today (success or failure), to avoid retry storms. */
export function hasAttemptedDailyBriefingToday(now: Date = new Date()): boolean {
    return lastAttemptDay === localDayKey(now);
}

/**
 * Returns today's briefing: cached if present (unless `force`), otherwise generated via the
 * configured AI provider. Resolves null on any failure; never throws and never blocks past the
 * generation timeout.
 */
export function ensureDailyBriefing(options: { force?: boolean; language?: Language; now?: Date } = {}): Promise<DailyBriefing | null> {
    const now = options.now ?? new Date();
    const day = localDayKey(now);
    if (!options.force) {
        const cached = readCachedDailyBriefing(now);
        if (cached) return Promise.resolve(cached.briefing);
    }
    if (inFlight) return inFlight;
    lastAttemptDay = day;
    inFlight = (async () => {
        try {
            const { settings, tasks, projects } = useTaskStore.getState();
            if (!isAIMorningBriefingEnabled(settings)) return null;
            const provider = settings.ai?.provider ?? 'openai';
            const apiKey = await loadAIKey(provider);
            if (!apiKey && isAIKeyRequired(settings)) return null;
            const config = await buildAIConfig(settings, apiKey, options.language ?? 'en');
            // One quick attempt: no multi-minute retries for a background briefing.
            const aiProvider = createAIProvider({ ...config, timeoutMs: Math.min(config.timeoutMs ?? 20_000, 20_000) });
            const briefing = await generateDailyBriefing({
                provider: aiProvider, tasks, projects, now, language: options.language,
            });
            if (briefing) writeCache(day, briefing);
            return briefing;
        } catch (error) {
            void logWarn('Daily briefing generation failed', { scope: 'ai', extra: { error: error instanceof Error ? error.name : 'unknown' } });
            return null;
        } finally {
            inFlight = null;
            notify();
        }
    })();
    return inFlight;
}

export function resetDailyBriefingStateForTests(): void {
    inFlight = null;
    lastAttemptDay = null;
    listeners.clear();
}

