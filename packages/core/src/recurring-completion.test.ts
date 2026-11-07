import { describe, expect, it } from 'vitest';

import {
    RECURRING_TICK_GUARD_MS,
    findJustCompletedOccurrence,
    findNextOccurrence,
    formatBulkRepeatTickPrompt,
    formatRepeatTickPrompt,
    formatRepeatingDoneMessage,
    getOccurrenceDate,
    getRecurrenceSeriesId,
    isRepeatingTask,
} from './recurring-completion';
import type { Task } from './types';

const completedAt = '2026-11-07T00:09:31.000Z';
const now = Date.parse(completedAt);
const task = (id: string, overrides: Partial<Task> = {}): Task => ({
    id, title: 'Call Brian', status: 'next', tags: [], contexts: [],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...overrides,
});
const done = task('first', { status: 'done', completedAt, recurrence: { rule: 'weekly', strategy: 'fluid' } });
const next = task('second', {
    recurrence: { rule: 'weekly', strategy: 'fluid', seriesId: 'first' }, dueDate: '2026-11-14', createdAt: completedAt, updatedAt: completedAt,
});
const t = (key: string) => key;

describe('recurring completion', () => {
    it('knows a repeating task and its series', () => {
        expect(isRepeatingTask(done)).toBe(true);
        expect(isRepeatingTask(task('plain'))).toBe(false);
        expect(getRecurrenceSeriesId(done)).toBe('first');
        expect(getRecurrenceSeriesId(next)).toBe('first');
        expect(getRecurrenceSeriesId(task('legacy', { recurrence: 'weekly' }))).toBe('legacy');
        expect(getRecurrenceSeriesId(task('plain'))).toBeUndefined();
    });

    it('finds the occurrence the completion generated, ahead of any other open one', () => {
        const older = task('older', { recurrence: { rule: 'weekly', seriesId: 'first' }, dueDate: '2026-11-01' });
        expect(findNextOccurrence([done, older, next], done)?.id).toBe('second');
    });

    it('falls back to the earliest open occurrence when the store reused a follow-up', () => {
        const later = task('later', { recurrence: { rule: 'weekly', seriesId: 'first' }, dueDate: '2026-11-21' });
        const sooner = task('sooner', { recurrence: { rule: 'weekly', seriesId: 'first' }, dueDate: '2026-11-14' });
        expect(findNextOccurrence([done, later, sooner], done)?.id).toBe('sooner');
    });

    it('finds nothing when the series has no open occurrence', () => {
        const trashed = { ...next, deletedAt: completedAt };
        const finished = { ...next, status: 'done' as const };
        const otherSeries = task('other', { recurrence: { rule: 'weekly', seriesId: 'else' } });
        expect(findNextOccurrence([done, trashed, finished, otherSeries], done)).toBeUndefined();
        expect(findNextOccurrence([task('plain')], task('plain'))).toBeUndefined();
    });

    it('notices an occurrence of the series completed within the window', () => {
        expect(findJustCompletedOccurrence([done, next], next, now + 1000)?.id).toBe('first');
        expect(findJustCompletedOccurrence([done, next], next, now + RECURRING_TICK_GUARD_MS - 1)?.id).toBe('first');
    });

    it('leaves a tick alone once the window has passed, or when nothing recent is in the series', () => {
        expect(findJustCompletedOccurrence([done, next], next, now + RECURRING_TICK_GUARD_MS)).toBeUndefined();
        expect(findJustCompletedOccurrence([{ ...done, status: 'next' }, next], next, now)).toBeUndefined();
        expect(findJustCompletedOccurrence([{ ...done, deletedAt: completedAt }, next], next, now)).toBeUndefined();
        const otherSeries = task('other', { recurrence: { rule: 'weekly' } });
        expect(findJustCompletedOccurrence([done, otherSeries], otherSeries, now)).toBeUndefined();
        expect(findJustCompletedOccurrence([done, task('plain')], task('plain'), now)).toBeUndefined();
    });

    it('never guards the done copy itself', () => {
        expect(findJustCompletedOccurrence([done, next], done, now)).toBeUndefined();
    });

    it('uses the date a row shows first', () => {
        expect(getOccurrenceDate({ dueDate: '2026-11-14', startTime: '2026-11-13' })).toBe('2026-11-14');
        expect(getOccurrenceDate({ startTime: '2026-11-13' })).toBe('2026-11-13');
        expect(getOccurrenceDate({ reviewAt: '2026-11-12' })).toBe('2026-11-12');
    });

    it('words the toast with the next date', () => {
        expect(formatRepeatingDoneMessage(t, next)).toBe('Done. Repeats next on Sat 14 Nov');
        expect(formatRepeatingDoneMessage(t, {})).toBe('Done. It repeats.');
    });

    it('names the period in the question only when the series steps by one', () => {
        expect(formatRepeatTickPrompt(t, { recurrence: { rule: 'daily' } })).toBe("This repeats. Mark tomorrow's as done too?");
        expect(formatRepeatTickPrompt(t, { recurrence: 'weekly' })).toBe("This repeats. Mark next week's as done too?");
        expect(formatRepeatTickPrompt(t, { recurrence: { rule: 'monthly' } })).toBe("This repeats. Mark next month's as done too?");
        expect(formatRepeatTickPrompt(t, { recurrence: { rule: 'yearly' } })).toBe("This repeats. Mark next year's as done too?");
        expect(formatRepeatTickPrompt(t, { recurrence: { rule: 'weekly', rrule: 'FREQ=WEEKLY;INTERVAL=2' } }))
            .toBe('This repeats. Mark the next one as done too?');
        expect(formatRepeatTickPrompt(t, { recurrence: { rule: 'weekly', byDay: ['MO', 'WE'] } }))
            .toBe('This repeats. Mark the next one as done too?');
        expect(formatBulkRepeatTickPrompt(t, 3)).toBe('3 of these repeat. Mark the next ones as done too?');
    });
});
