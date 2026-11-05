import { describe, expect, it } from 'vitest';
import {
    AI_BURST_LIMIT_PER_MINUTE,
    AI_USAGE_LIMIT_STORAGE_KEY,
    AI_USAGE_STORAGE_KEY,
    DEFAULT_ASSISTANT_DAILY_LIMIT,
    consumeAIUsage,
    formatAIUsageBlockMessage,
    readAIUsage,
    readAssistantDailyLimit,
    totalAIUsage,
    writeAssistantDailyLimit,
} from './usage-guard';

const memory = () => {
    const map = new Map<string, string>();
    return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); } };
};

const at = (h: number, m = 0, s = 0) => new Date(2026, 10, 5, h, m, s);

describe('AI usage guard', () => {
    it('counts requests per feature per day under stride:ai:usage:v1', () => {
        const storage = memory();
        consumeAIUsage(storage, 'assistant', { now: at(9) });
        consumeAIUsage(storage, 'assistant', { now: at(9, 1) });
        consumeAIUsage(storage, 'capture', { now: at(9, 2) });
        const record = readAIUsage(storage, at(9, 3));
        expect(record.counts).toEqual({ assistant: 2, capture: 1 });
        expect(totalAIUsage(record)).toBe(3);
        expect(storage.map.has(AI_USAGE_STORAGE_KEY)).toBe(true);
    });

    it('resets on a new day', () => {
        const storage = memory();
        consumeAIUsage(storage, 'assistant', { now: at(23, 59) });
        expect(readAIUsage(storage, new Date(2026, 10, 6, 0, 1)).counts).toEqual({});
    });

    it('applies the per-minute burst guard per feature and lifts it after the window', () => {
        const storage = memory();
        for (let i = 0; i < AI_BURST_LIMIT_PER_MINUTE; i += 1) {
            expect(consumeAIUsage(storage, 'coach', { now: at(10, 0, i) }).allowed).toBe(true);
        }
        const blocked = consumeAIUsage(storage, 'coach', { now: at(10, 0, 40) });
        expect(blocked).toEqual({ allowed: false, reason: 'burst', limit: AI_BURST_LIMIT_PER_MINUTE, retryAfterSeconds: 20 });
        expect(consumeAIUsage(storage, 'assistant', { now: at(10, 0, 40) }).allowed).toBe(true);
        expect(consumeAIUsage(storage, 'coach', { now: at(10, 1, 1) }).allowed).toBe(true);
        // A blocked request is not counted.
        expect(readAIUsage(storage, at(10, 1, 2)).counts.coach).toBe(AI_BURST_LIMIT_PER_MINUTE + 1);
    });

    it('enforces the daily Assistant cap until midnight; Unlimited lifts it', () => {
        const storage = memory();
        for (let i = 0; i < 3; i += 1) consumeAIUsage(storage, 'assistant', { now: at(8, i * 5), dailyLimit: 3 });
        const blocked = consumeAIUsage(storage, 'assistant', { now: at(23, 0), dailyLimit: 3 });
        expect(blocked).toEqual({ allowed: false, reason: 'daily', limit: 3, retryAfterSeconds: 3600 });
        // Other features are not affected by the Assistant cap.
        expect(consumeAIUsage(storage, 'capture', { now: at(23, 0), dailyLimit: 3 }).allowed).toBe(true);
        expect(consumeAIUsage(storage, 'assistant', { now: at(23, 1), dailyLimit: null }).allowed).toBe(true);
        expect(consumeAIUsage(storage, 'assistant', { now: new Date(2026, 10, 6, 0, 0, 1), dailyLimit: 3 }).allowed).toBe(true);
    });

    it('stores the daily limit, defaulting to 300 and accepting Unlimited', () => {
        const storage = memory();
        expect(readAssistantDailyLimit(storage)).toBe(DEFAULT_ASSISTANT_DAILY_LIMIT);
        writeAssistantDailyLimit(storage, null);
        expect(readAssistantDailyLimit(storage)).toBeNull();
        writeAssistantDailyLimit(storage, 1000);
        expect(readAssistantDailyLimit(storage)).toBe(1000);
        storage.setItem(AI_USAGE_LIMIT_STORAGE_KEY, '{"assistantDailyLimit":-4}');
        expect(readAssistantDailyLimit(storage)).toBe(DEFAULT_ASSISTANT_DAILY_LIMIT);
    });

    it('never blocks on corrupt or failing storage', () => {
        const storage = memory();
        storage.setItem(AI_USAGE_STORAGE_KEY, '{not json');
        expect(consumeAIUsage(storage, 'assistant', { now: at(9) }).allowed).toBe(true);
        const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
        expect(consumeAIUsage(throwing, 'assistant', { now: at(9), dailyLimit: 1 }).allowed).toBe(true);
        expect(consumeAIUsage(null, 'assistant').allowed).toBe(true);
    });

    it('explains a block in plain language', () => {
        expect(formatAIUsageBlockMessage({ allowed: false, reason: 'burst', limit: 30, retryAfterSeconds: 20 })).toBe("That's a lot of requests in a minute. Wait 20 s and try again.");
        expect(formatAIUsageBlockMessage({ allowed: false, reason: 'daily', limit: 300, retryAfterSeconds: 3600 }))
            .toBe("You've reached today's Assistant limit (300 requests). It resets at midnight, in about 60 min. You can change the limit in Settings → AI.");
    });
});
