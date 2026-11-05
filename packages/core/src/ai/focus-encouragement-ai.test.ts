import { describe, expect, it, vi } from 'vitest';
import {
    generateFocusEncouragement,
    getFallbackEncouragement,
    getFocusMilestone,
    parseFocusEncouragement,
    runFocusPrompt,
} from './focus-encouragement-ai';

const provider = (text: string) => ({ generateText: vi.fn(async () => text) });

describe('encouragement', () => {
    it('validates length and content', () => {
        expect(parseFocusEncouragement('"Great start on the report."')).toBe('Great start on the report.');
        expect(parseFocusEncouragement('one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen')).toBeNull();
        expect(parseFocusEncouragement('see https://x.y')).toBeNull();
        expect(parseFocusEncouragement(null)).toBeNull();
    });
    it('generates or returns null', async () => {
        const input = { taskTitle: 't', milestone: 'half' as const, done: 2, total: 4 };
        expect(await generateFocusEncouragement(provider('Halfway, nice pace.'), input)).toBe('Halfway, nice pace.');
        expect(await generateFocusEncouragement({}, input)).toBeNull();
    });
    it('has fallbacks and milestones', () => {
        expect(getFallbackEncouragement('end', 3).length).toBeGreaterThan(0);
        expect(getFocusMilestone(1, 5)).toBe('first');
        expect(getFocusMilestone(3, 5)).toBe('half');
        expect(getFocusMilestone(5, 5)).toBe('last');
        expect(getFocusMilestone(2, 5)).toBeNull();
        expect(getFocusMilestone(0, 5)).toBeNull();
    });
});

describe('runFocusPrompt', () => {
    it('resolves null on timeout, errors or a provider without generateText', async () => {
        vi.useFakeTimers();
        const slow = { generateText: () => new Promise<string>(() => undefined) };
        const pending = runFocusPrompt(slow, { system: 's', user: 'u' }, 50);
        await vi.advanceTimersByTimeAsync(60);
        expect(await pending).toBeNull();
        vi.useRealTimers();
        expect(await runFocusPrompt({ generateText: async () => { throw new Error('boom'); } }, { system: 's', user: 'u' }, 50)).toBeNull();
        expect(await runFocusPrompt({}, { system: 's', user: 'u' }, 50)).toBeNull();
    });
});
