import { describe, expect, it } from 'vitest';

import { joinDateTime, splitDateTime } from './date-draft';

describe('splitDateTime', () => {
    it('returns empty parts for an undefined/null/empty value', () => {
        expect(splitDateTime(undefined)).toEqual({ date: '', time: '' });
        expect(splitDateTime(null)).toEqual({ date: '', time: '' });
        expect(splitDateTime('')).toEqual({ date: '', time: '' });
    });

    it('returns empty parts for an unparseable value', () => {
        expect(splitDateTime('not-a-date')).toEqual({ date: '', time: '' });
    });

    it('splits a date-only value with an empty time (no implicit time)', () => {
        expect(splitDateTime('2025-06-01')).toEqual({ date: '2025-06-01', time: '' });
    });

    it('splits a value with an explicit time component', () => {
        expect(splitDateTime('2025-06-01T09:30')).toEqual({ date: '2025-06-01', time: '09:30' });
    });

    it('splits a value with seconds, keeping HH:mm precision', () => {
        expect(splitDateTime('2025-06-01T09:30:15')).toEqual({ date: '2025-06-01', time: '09:30' });
    });

    it('treats midnight with an explicit time component as having a time', () => {
        expect(splitDateTime('2025-06-01T00:00')).toEqual({ date: '2025-06-01', time: '00:00' });
    });
});

describe('joinDateTime', () => {
    it('returns an empty string when the date is empty, regardless of time/defaultTime', () => {
        expect(joinDateTime('', '')).toBe('');
        expect(joinDateTime('', '09:30')).toBe('');
        expect(joinDateTime('', '', { defaultTime: '09:00' })).toBe('');
    });

    it('returns the bare date when time and defaultTime are both absent', () => {
        expect(joinDateTime('2025-06-01', '')).toBe('2025-06-01');
    });

    it('joins date and time with a literal T', () => {
        expect(joinDateTime('2025-06-01', '09:30')).toBe('2025-06-01T09:30');
    });

    it('applies opts.defaultTime only when time is empty and date is present', () => {
        expect(joinDateTime('2025-06-01', '', { defaultTime: '08:00' })).toBe('2025-06-01T08:00');
    });

    it('prefers the explicit time over defaultTime', () => {
        expect(joinDateTime('2025-06-01', '09:30', { defaultTime: '08:00' })).toBe('2025-06-01T09:30');
    });

    it('drops the time when clearing back to a date-only value', () => {
        expect(joinDateTime('2025-06-01', '')).toBe('2025-06-01');
    });
});

describe('splitDateTime / joinDateTime round-trip', () => {
    it('round-trips a date-only value', () => {
        const iso = '2025-06-01';
        const { date, time } = splitDateTime(iso);
        expect(joinDateTime(date, time)).toBe(iso);
    });

    it('round-trips a value with a time component', () => {
        const iso = '2025-06-01T09:30';
        const { date, time } = splitDateTime(iso);
        expect(joinDateTime(date, time)).toBe(iso);
    });

    it('round-trips through an empty value', () => {
        const { date, time } = splitDateTime('');
        expect(joinDateTime(date, time)).toBe('');
    });
});
