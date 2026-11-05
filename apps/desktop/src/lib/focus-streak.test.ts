import { beforeEach, describe, expect, it } from 'vitest';
import { FOCUS_STREAK_STORAGE_KEY, computeFocusStreak, getFocusStreak, recordFocusDay } from './focus-streak';

describe('focus streak', () => {
    beforeEach(() => localStorage.clear());

    it('counts consecutive days ending today or yesterday', () => {
        expect(computeFocusStreak(['2026-07-01', '2026-07-02', '2026-07-03'], '2026-07-03')).toBe(3);
        expect(computeFocusStreak(['2026-07-01', '2026-07-02'], '2026-07-03')).toBe(2);
        expect(computeFocusStreak(['2026-06-28'], '2026-07-03')).toBe(0);
        expect(computeFocusStreak(['2026-02-28', '2026-03-01'], '2026-03-01')).toBe(2);
    });

    it('records a day once, locally, and ignores junk storage', () => {
        const day = new Date(2026, 6, 3, 10);
        expect(recordFocusDay(day)).toBe(1);
        expect(recordFocusDay(day)).toBe(1);
        expect(recordFocusDay(new Date(2026, 6, 4, 10))).toBe(2);
        expect(JSON.parse(localStorage.getItem(FOCUS_STREAK_STORAGE_KEY)!)).toHaveLength(2);
        localStorage.setItem(FOCUS_STREAK_STORAGE_KEY, '{"x":1}');
        expect(getFocusStreak(day)).toBe(0);
    });
});
