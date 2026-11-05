import { localDayKey } from './daily-briefing';

/**
 * Local, per-device AI usage guard. Counts AI requests per feature per day and keeps a one-minute
 * window per feature, so a stuck loop, a script or a mashed key cannot run up a provider bill or
 * get the key rate-limited. Pure functions over a small storage interface; callers decide what a
 * blocked request falls back to.
 */

export const AI_USAGE_STORAGE_KEY = 'stride:ai:usage:v1';
export const AI_USAGE_LIMIT_STORAGE_KEY = 'stride:ai:usage-limit:v1';

export type AIUsageFeature = 'assistant' | 'capture' | 'area' | 'coach' | 'briefing' | 'other';
export const AI_USAGE_FEATURES: readonly AIUsageFeature[] = ['assistant', 'capture', 'area', 'coach', 'briefing', 'other'];

/** Burst guard: requests per feature in any rolling minute. */
export const AI_BURST_LIMIT_PER_MINUTE = 30;
const MINUTE_MS = 60_000;
/** Default daily cap on Assistant turns; null means unlimited. */
export const DEFAULT_ASSISTANT_DAILY_LIMIT = 300;
export const ASSISTANT_DAILY_LIMIT_OPTIONS: readonly (number | null)[] = [100, 300, 1000, null];

export interface AIUsageStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

export interface AIUsageRecord {
    day: string;
    counts: Partial<Record<AIUsageFeature, number>>;
    /** Request timestamps (ms) in the last minute, per feature. */
    recent: Partial<Record<AIUsageFeature, number[]>>;
}

export type AIUsageDecision =
    | { allowed: true }
    | { allowed: false; reason: 'burst' | 'daily'; limit: number; retryAfterSeconds: number };

const isFeature = (value: string): value is AIUsageFeature => (AI_USAGE_FEATURES as readonly string[]).includes(value);

const emptyRecord = (day: string): AIUsageRecord => ({ day, counts: {}, recent: {} });

/** Today's record; a stored record from another day, or a corrupt one, reads as empty. */
export function readAIUsage(storage: AIUsageStorage | null | undefined, now: Date = new Date()): AIUsageRecord {
    const day = localDayKey(now);
    try {
        const raw = storage?.getItem(AI_USAGE_STORAGE_KEY);
        if (!raw) return emptyRecord(day);
        const parsed = JSON.parse(raw) as Partial<AIUsageRecord> | null;
        if (!parsed || typeof parsed !== 'object' || parsed.day !== day) return emptyRecord(day);
        const record = emptyRecord(day);
        const cutoff = now.getTime() - MINUTE_MS;
        for (const [key, value] of Object.entries(parsed.counts ?? {})) {
            if (isFeature(key) && typeof value === 'number' && Number.isFinite(value) && value > 0) record.counts[key] = Math.floor(value);
        }
        for (const [key, value] of Object.entries(parsed.recent ?? {})) {
            if (!isFeature(key) || !Array.isArray(value)) continue;
            const stamps = value.filter((t): t is number => typeof t === 'number' && t > cutoff && t <= now.getTime() + MINUTE_MS);
            if (stamps.length) record.recent[key] = stamps.slice(-AI_BURST_LIMIT_PER_MINUTE * 2);
        }
        return record;
    } catch {
        return emptyRecord(day);
    }
}

/** Daily cap for Assistant turns: a positive integer, or null for unlimited. Defaults to 300. */
export function readAssistantDailyLimit(storage: AIUsageStorage | null | undefined): number | null {
    try {
        const raw = storage?.getItem(AI_USAGE_LIMIT_STORAGE_KEY);
        if (raw === null || raw === undefined) return DEFAULT_ASSISTANT_DAILY_LIMIT;
        const parsed = JSON.parse(raw) as { assistantDailyLimit?: unknown } | null;
        const value = parsed?.assistantDailyLimit;
        if (value === null) return null;
        if (typeof value === 'number' && Number.isInteger(value) && value > 0) return Math.min(value, 100_000);
        return DEFAULT_ASSISTANT_DAILY_LIMIT;
    } catch {
        return DEFAULT_ASSISTANT_DAILY_LIMIT;
    }
}

export function writeAssistantDailyLimit(storage: AIUsageStorage | null | undefined, limit: number | null): void {
    const value = limit === null ? null : Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100_000) : DEFAULT_ASSISTANT_DAILY_LIMIT;
    try { storage?.setItem(AI_USAGE_LIMIT_STORAGE_KEY, JSON.stringify({ assistantDailyLimit: value })); } catch { /* best effort */ }
}

const secondsUntilNextDay = (now: Date): number => {
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
    return Math.max(1, Math.ceil((next.getTime() - now.getTime()) / 1000));
};

/** Whether one more request for `feature` is allowed now (does not record it). */
export function checkAIUsage(
    record: AIUsageRecord,
    feature: AIUsageFeature,
    options: { now?: Date; dailyLimit?: number | null } = {},
): AIUsageDecision {
    const now = options.now ?? new Date();
    const dailyLimit = feature === 'assistant' ? options.dailyLimit ?? null : null;
    if (dailyLimit !== null && (record.counts[feature] ?? 0) >= dailyLimit) {
        return { allowed: false, reason: 'daily', limit: dailyLimit, retryAfterSeconds: secondsUntilNextDay(now) };
    }
    const cutoff = now.getTime() - MINUTE_MS;
    const recent = (record.recent[feature] ?? []).filter((t) => t > cutoff).sort((a, b) => a - b);
    if (recent.length >= AI_BURST_LIMIT_PER_MINUTE) {
        const oldest = recent[recent.length - AI_BURST_LIMIT_PER_MINUTE];
        return { allowed: false, reason: 'burst', limit: AI_BURST_LIMIT_PER_MINUTE, retryAfterSeconds: Math.max(1, Math.ceil((oldest + MINUTE_MS - now.getTime()) / 1000)) };
    }
    return { allowed: true };
}

export function recordAIUsage(record: AIUsageRecord, feature: AIUsageFeature, now: Date = new Date()): AIUsageRecord {
    const cutoff = now.getTime() - MINUTE_MS;
    return {
        day: record.day,
        counts: { ...record.counts, [feature]: (record.counts[feature] ?? 0) + 1 },
        recent: { ...record.recent, [feature]: [...(record.recent[feature] ?? []).filter((t) => t > cutoff), now.getTime()].slice(-AI_BURST_LIMIT_PER_MINUTE * 2) },
    };
}

/** Check and, when allowed, count one request. Storage failures never block AI. */
export function consumeAIUsage(
    storage: AIUsageStorage | null | undefined,
    feature: AIUsageFeature,
    options: { now?: Date; dailyLimit?: number | null } = {},
): AIUsageDecision {
    const now = options.now ?? new Date();
    const record = readAIUsage(storage, now);
    const decision = checkAIUsage(record, feature, { now, dailyLimit: options.dailyLimit });
    if (!decision.allowed) return decision;
    try { storage?.setItem(AI_USAGE_STORAGE_KEY, JSON.stringify(recordAIUsage(record, feature, now))); } catch { /* best effort */ }
    return decision;
}

export const totalAIUsage = (record: AIUsageRecord): number =>
    Object.values(record.counts).reduce((sum, n) => sum + (n ?? 0), 0);

const formatWait = (seconds: number): string => {
    if (seconds < 90) return `${seconds} s`;
    const minutes = Math.ceil(seconds / 60);
    if (minutes < 90) return `${minutes} min`;
    return `${Math.round(minutes / 60)} h`;
};

/** Friendly message for a blocked request. */
export function formatAIUsageBlockMessage(decision: Extract<AIUsageDecision, { allowed: false }>): string {
    if (decision.reason === 'daily') {
        return `You've reached today's Assistant limit (${decision.limit} requests). It resets at midnight, in about ${formatWait(decision.retryAfterSeconds)}. You can change the limit in Settings → AI.`;
    }
    return `That's a lot of requests in a minute. Wait ${formatWait(decision.retryAfterSeconds)} and try again.`;
}
