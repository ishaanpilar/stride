import { describe, expect, it } from 'vitest';
import type { Task } from './types';
import { formatRemainingDuration, getTodayProgress } from './today-progress';

const now = new Date(2026, 10, 5, 12, 0, 0);
const base = { tags: [], contexts: [], createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' };
const make = (overrides: Partial<Task>): Task => ({ id: Math.random().toString(), title: 't', status: 'next', ...base, ...overrides } as Task);

describe('getTodayProgress', () => {
    it('counts due or planned today, ignoring other days, deleted and reference', () => {
        const tasks = [
            make({ dueDate: '2026-11-05' }),
            make({ startTime: '2026-11-05T09:00:00' }),
            make({ dueDate: '2026-11-06' }),
            make({ dueDate: '2026-11-05', deletedAt: '2026-11-05T01:00:00.000Z' }),
            make({ dueDate: '2026-11-05', status: 'reference' }),
        ];
        expect(getTodayProgress(tasks, now)).toMatchObject({ total: 2, done: 0, left: 2, fraction: 0 });
    });

    it('counts only tasks completed today as done', () => {
        const doneToday = make({ dueDate: '2026-11-05', status: 'done', completedAt: new Date(2026, 10, 5, 9).toISOString() });
        const doneBefore = make({ dueDate: '2026-11-05', status: 'done', completedAt: new Date(2026, 10, 3, 9).toISOString(), updatedAt: new Date(2026, 10, 3, 9).toISOString() });
        const open = make({ dueDate: '2026-11-05' });
        const progress = getTodayProgress([doneToday, doneBefore, open], now);
        expect(progress).toMatchObject({ total: 2, done: 1, left: 1 });
        expect(progress.fraction).toBe(0.5);
    });

    it('sums estimates of remaining tasks only and is 0 without estimates', () => {
        const progress = getTodayProgress([
            make({ dueDate: '2026-11-05', timeEstimate: '1hr' }),
            make({ dueDate: '2026-11-05', timeEstimate: '30min' }),
            make({ dueDate: '2026-11-05' }),
            make({ dueDate: '2026-11-05', status: 'done', completedAt: new Date(2026, 10, 5, 8).toISOString(), timeEstimate: '2hr' }),
        ], now);
        expect(progress.remainingMinutes).toBe(90);
        expect(getTodayProgress([make({ dueDate: '2026-11-05' })], now).remainingMinutes).toBe(0);
    });

    it('handles an empty day', () => {
        expect(getTodayProgress([], now)).toEqual({ total: 0, done: 0, left: 0, remainingMinutes: 0, fraction: 0 });
    });
});

describe('formatRemainingDuration', () => {
    it('formats hours and minutes', () => {
        expect(formatRemainingDuration(130)).toBe('2 h 10 m');
        expect(formatRemainingDuration(45)).toBe('45 m');
        expect(formatRemainingDuration(180)).toBe('3 h');
        expect(formatRemainingDuration(0)).toBe('');
    });
});
