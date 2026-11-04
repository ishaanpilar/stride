import { describe, expect, it, vi } from 'vitest';

import type { Project, Task } from '../types';
import {
    buildDailyBriefingInput,
    buildDailyBriefingPrompt,
    generateDailyBriefing,
    isAIMorningBriefingEnabled,
    parseBriefingCache,
    parseDailyBriefing,
    serializeBriefingCache,
} from './daily-briefing';

const NOW = new Date(2026, 10, 4, 8, 0, 0);
const iso = (d: Date) => d.toISOString();
const day = (offset: number, h = 12) => iso(new Date(2026, 10, 4 + offset, h, 0, 0));

const task = (id: string, extra: Partial<Task> = {}): Task => ({
    id, title: `Task ${id}`, status: 'next', tags: [], contexts: [],
    createdAt: day(-10), updatedAt: day(-10), ...extra,
});
const projects: Project[] = [
    { id: 'p1', title: 'Website', status: 'active', color: '#fff', order: 0, tagIds: [], createdAt: day(-10), updatedAt: day(-10) } as Project,
];

const tasks: Task[] = [
    task('over', { dueDate: day(-1), priority: 'high', projectId: 'p1', description: 'SECRET DESCRIPTION' }),
    task('today', { dueDate: day(0), contexts: ['@desk'] }),
    task('meet', { startTime: day(0, 15), status: 'inbox' }),
    task('star', { isFocusedToday: true }),
    task('soon', { dueDate: day(2) }),
    task('wait', { status: 'waiting' }),
    task('next1'),
    task('far', { dueDate: day(30) }),
    task('done', { status: 'done', dueDate: day(0) }),
    task('trash', { dueDate: day(0), deletedAt: day(-1) }),
    task('someday', { status: 'someday' }),
];

describe('buildDailyBriefingInput', () => {
    const input = buildDailyBriefingInput(tasks, projects, NOW);
    it('buckets tasks and excludes done/deleted/someday', () => {
        expect(input.overdue.map((t) => t.id)).toEqual(['over']);
        expect(input.dueToday.map((t) => t.id)).toEqual(['today']);
        expect(input.scheduled.map((t) => t.id)).toEqual(['meet']);
        expect(input.focus.map((t) => t.id)).toEqual(['star']);
        expect(input.upcoming.map((t) => t.id)).toEqual(['soon']);
        expect(input.waiting.map((t) => t.id)).toEqual(['wait']);
        expect(input.nextActions.map((t) => t.id)).toEqual(expect.arrayContaining(['next1', 'far']));
        const all = JSON.stringify(input);
        for (const id of ['done', 'trash', 'someday']) expect(all).not.toContain(`"id":"${id}"`);
    });
    it('sends compact fields only and never descriptions', () => {
        expect(input.overdue[0]).toMatchObject({ id: 'over', project: 'Website', priority: 'high', status: 'next' });
        expect(JSON.stringify(input)).not.toContain('SECRET');
    });
});

describe('buildDailyBriefingPrompt', () => {
    it('includes sections, json instruction and language', () => {
        const prompt = buildDailyBriefingPrompt(buildDailyBriefingInput(tasks, projects, NOW), 'de');
        expect(prompt.system).toContain('JSON');
        expect(prompt.system).toContain('"de"');
        expect(prompt.user).toContain('OVERDUE:');
        expect(prompt.user).toContain('DUE_NEXT_3_DAYS:');
        expect(prompt.user).not.toContain('SECRET');
    });
});

describe('parseDailyBriefing', () => {
    const ids = new Set(['a', 'b', 'c', 'd', 'e', 'f']);
    it('parses fenced JSON, drops unknown/duplicate ids, caps lengths', () => {
        const raw = '```json\n' + JSON.stringify({
            headline: 'x'.repeat(200),
            top: [
                { taskId: 'a', why: 'urgent', estimateMinutes: 25.4 },
                { taskId: 'zzz', why: 'hallucinated' },
                { taskId: 'a', why: 'dup' },
                { taskId: 'b', why: 'ok', estimateMinutes: -5 },
                { taskId: 'c' }, { taskId: 'd', why: '' }, { taskId: 'e', why: '' }, { taskId: 'f', why: '' },
            ],
            schedule: [{ time: '09:30', title: 'Standup' }, { time: 5, title: 'bad' }],
            suggestion: 'Start with a',
        }) + '\n```';
        const result = parseDailyBriefing(raw, ids)!;
        expect(result.headline.length).toBeLessThanOrEqual(80);
        expect(result.top.map((t) => t.taskId)).toEqual(['a', 'b', 'c', 'd', 'e']);
        expect(result.top[0].estimateMinutes).toBe(25);
        expect(result.top[1].estimateMinutes).toBeUndefined();
        expect(result.schedule).toEqual([{ time: '09:30', title: 'Standup' }]);
    });
    it('returns null for malformed or empty output', () => {
        expect(parseDailyBriefing('not json at all', ids)).toBeNull();
        expect(parseDailyBriefing('', ids)).toBeNull();
        expect(parseDailyBriefing('[1,2]', ids)).toBeNull();
        expect(parseDailyBriefing('{"top":[{"taskId":"nope","why":"x"}]}', ids)).toBeNull();
    });
});

describe('generateDailyBriefing fallback', () => {
    const base = { tasks, projects, now: NOW };
    it('returns a validated briefing on success', async () => {
        const generateText = vi.fn().mockResolvedValue(JSON.stringify({
            headline: '1 overdue', top: [{ taskId: 'over', why: 'late' }, { taskId: 'ghost', why: 'x' }], schedule: [], suggestion: 'Pomodoro on over',
        }));
        const result = await generateDailyBriefing({ ...base, provider: { generateText } });
        expect(result?.top.map((t) => t.taskId)).toEqual(['over']);
        expect(generateText).toHaveBeenCalledTimes(1);
    });
    it('returns null on malformed output, provider error, missing support, no content', async () => {
        expect(await generateDailyBriefing({ ...base, provider: { generateText: async () => 'oops' } })).toBeNull();
        expect(await generateDailyBriefing({ ...base, provider: { generateText: async () => { throw new Error('boom'); } } })).toBeNull();
        expect(await generateDailyBriefing({ ...base, provider: {} })).toBeNull();
        const generateText = vi.fn();
        expect(await generateDailyBriefing({ tasks: [], provider: { generateText }, now: NOW })).toBeNull();
        expect(generateText).not.toHaveBeenCalled();
    });
    it('times out without blocking', async () => {
        let aborted = false;
        const generateText = (_p: unknown, o?: { signal?: AbortSignal }) => new Promise<string>(() => {
            o?.signal?.addEventListener('abort', () => { aborted = true; });
        });
        const result = await generateDailyBriefing({ ...base, provider: { generateText }, timeoutMs: 20 });
        expect(result).toBeNull();
        expect(aborted).toBe(true);
    });
});

describe('settings + cache', () => {
    it('defaults on when AI enabled, off otherwise or when opted out', () => {
        expect(isAIMorningBriefingEnabled({ ai: { enabled: true } })).toBe(true);
        expect(isAIMorningBriefingEnabled({ ai: { enabled: true, morningBriefing: false } })).toBe(false);
        expect(isAIMorningBriefingEnabled({ ai: { enabled: false } })).toBe(false);
        expect(isAIMorningBriefingEnabled({})).toBe(false);
    });
    it('round-trips cache for the same day only', () => {
        const briefing = { headline: 'h', top: [{ taskId: 'a', why: 'w' }], schedule: [], suggestion: 's' };
        const raw = serializeBriefingCache('2026-11-04', briefing, NOW);
        expect(parseBriefingCache(raw, '2026-11-04')?.briefing).toEqual(briefing);
        expect(parseBriefingCache(raw, '2026-11-05')).toBeNull();
        expect(parseBriefingCache('garbage', '2026-11-04')).toBeNull();
        expect(parseBriefingCache(null, '2026-11-04')).toBeNull();
    });
});
