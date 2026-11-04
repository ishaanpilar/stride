import { describe, expect, it } from 'vitest';

import { computeRelativeStartTime, normalizeRelativeStartOffset, resolveRelativeStartUpdates } from './task-relative-start';

describe('relative task starts', () => {
    it('accepts a zero offset (start on the due date) but rejects positive amounts', () => {
        expect(normalizeRelativeStartOffset({ amount: 0, unit: 'day' })).toEqual({ amount: 0, unit: 'day' });
        expect(normalizeRelativeStartOffset({ amount: -0, unit: 'day' })).toEqual({ amount: 0, unit: 'day' });
        expect(normalizeRelativeStartOffset({ amount: 1, unit: 'day' })).toBeUndefined();
    });

    it('starts on the due date itself for zero offsets', () => {
        expect(computeRelativeStartTime('2026-03-12', { amount: 0, unit: 'day' })).toBe('2026-03-12');
        expect(computeRelativeStartTime('2026-03-12T09:30', { amount: 0, unit: 'hour' })).toBe('2026-03-12T09:30');
    });

    it('keeps a zero offset tracking a moved due date', () => {
        expect(resolveRelativeStartUpdates(
            { dueDate: '2026-03-12', startTime: '2026-03-12', relativeStartOffset: { amount: 0, unit: 'day' } },
            { dueDate: '2026-03-19' }
        )).toEqual({
            dueDate: '2026-03-19',
            startTime: '2026-03-19',
            relativeStartOffset: { amount: 0, unit: 'day' },
        });
    });

    it('does not create midnight-anchored sub-day starts from date-only due dates', () => {
        expect(computeRelativeStartTime('2026-03-12', { amount: -30, unit: 'minute' })).toBeUndefined();
        expect(computeRelativeStartTime('2026-03-12', { amount: -2, unit: 'hour' })).toBeUndefined();
    });

    it('preserves date-only starts for day and week offsets from date-only due dates', () => {
        expect(computeRelativeStartTime('2026-03-12', { amount: -1, unit: 'day' })).toBe('2026-03-11');
        expect(computeRelativeStartTime('2026-03-12', { amount: -1, unit: 'week' })).toBe('2026-03-05');
    });

    it('allows sub-day starts from timed due dates', () => {
        expect(computeRelativeStartTime('2026-03-12T09:30', { amount: -30, unit: 'minute' })).toBe('2026-03-12T09:00');
        expect(computeRelativeStartTime('2026-03-12T09:30', { amount: -2, unit: 'hour' })).toBe('2026-03-12T07:30');
    });

    it('clears invalid sub-day relative offsets when a due date is date-only', () => {
        expect(resolveRelativeStartUpdates(
            { dueDate: '2026-03-12', startTime: undefined, relativeStartOffset: undefined },
            { relativeStartOffset: { amount: -30, unit: 'minute' } }
        )).toEqual({ relativeStartOffset: undefined });
    });
});
