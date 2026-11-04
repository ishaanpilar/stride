import { describe, expect, it } from 'vitest';

import {
    TIME_SPENT_MAX_MINUTES,
    addTimeSpentMinutes,
    normalizeTimeSpentMinutes,
} from './time-spent';

describe('normalizeTimeSpentMinutes', () => {
    it('keeps positive whole minutes', () => {
        expect(normalizeTimeSpentMinutes(25)).toBe(25);
        expect(normalizeTimeSpentMinutes(1)).toBe(1);
    });

    it('treats absent, zero, and invalid values as undefined', () => {
        expect(normalizeTimeSpentMinutes(undefined)).toBeUndefined();
        expect(normalizeTimeSpentMinutes(null)).toBeUndefined();
        expect(normalizeTimeSpentMinutes(0)).toBeUndefined();
        expect(normalizeTimeSpentMinutes(-10)).toBeUndefined();
        expect(normalizeTimeSpentMinutes('25')).toBeUndefined();
        expect(normalizeTimeSpentMinutes(Number.NaN)).toBeUndefined();
        expect(normalizeTimeSpentMinutes(Number.POSITIVE_INFINITY)).toBeUndefined();
    });

    it('rounds fractional minutes and caps the total', () => {
        expect(normalizeTimeSpentMinutes(24.6)).toBe(25);
        expect(normalizeTimeSpentMinutes(TIME_SPENT_MAX_MINUTES + 5)).toBe(TIME_SPENT_MAX_MINUTES);
    });
});

describe('addTimeSpentMinutes', () => {
    it('adds a session to an existing total', () => {
        expect(addTimeSpentMinutes(50, 25)).toBe(75);
    });

    it('starts a total from nothing', () => {
        expect(addTimeSpentMinutes(undefined, 25)).toBe(25);
        expect(addTimeSpentMinutes(0, 25)).toBe(25);
    });

    it('ignores invalid increments', () => {
        expect(addTimeSpentMinutes(50, 0)).toBe(50);
        expect(addTimeSpentMinutes(50, -5)).toBe(50);
        expect(addTimeSpentMinutes(undefined, 0)).toBeUndefined();
    });

    it('caps at the maximum', () => {
        expect(addTimeSpentMinutes(TIME_SPENT_MAX_MINUTES, 25)).toBe(TIME_SPENT_MAX_MINUTES);
    });
});
