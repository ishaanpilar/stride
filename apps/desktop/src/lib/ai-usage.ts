import {
    consumeAIUsage,
    readAIUsage,
    readAssistantDailyLimit,
    writeAssistantDailyLimit,
    type AIUsageDecision,
    type AIUsageFeature,
    type AIUsageRecord,
    type AIUsageStorage,
} from '@stride/core';

/** Per-device AI usage guard backed by localStorage (`stride:ai:usage:v1`). */

const USAGE_EVENT = 'stride:ai-usage-changed';

const storage = (): AIUsageStorage | null => {
    try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
};

const notify = () => {
    try { if (typeof window !== 'undefined') window.dispatchEvent(new Event(USAGE_EVENT)); } catch { /* ignore */ }
};

/** Checks the per-minute burst guard (and the daily Assistant cap) and counts the request when allowed. */
export function consumeAiUsage(feature: AIUsageFeature, now: Date = new Date()): AIUsageDecision {
    const decision = consumeAIUsage(storage(), feature, { now, dailyLimit: readAssistantDailyLimit(storage()) });
    if (decision.allowed) notify();
    return decision;
}

export const getAiUsageToday = (now: Date = new Date()): AIUsageRecord => readAIUsage(storage(), now);

export const getAssistantDailyLimit = (): number | null => readAssistantDailyLimit(storage());

export function setAssistantDailyLimit(limit: number | null): void {
    writeAssistantDailyLimit(storage(), limit);
    notify();
}

export function subscribeAiUsage(listener: () => void): () => void {
    if (typeof window === 'undefined') return () => undefined;
    window.addEventListener(USAGE_EVENT, listener);
    return () => window.removeEventListener(USAGE_EVENT, listener);
}
