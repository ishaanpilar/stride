import { getPomodoroLocalDayKey } from '@stride/core';

/** Local-only focus streak (not synced): one entry per day with at least one finished focus session. */
export const FOCUS_STREAK_STORAGE_KEY = 'stride:focus-streak:v1';
const MAX_DAYS = 400;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const readDays = (): string[] => {
    try {
        const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(FOCUS_STREAK_STORAGE_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) return [];
        return Array.from(new Set(parsed.filter((d): d is string => typeof d === 'string' && DAY_RE.test(d)))).sort();
    } catch {
        return [];
    }
};

const dayKey = (date: Date): string => getPomodoroLocalDayKey(date.getTime());

const previousDay = (key: string): string => {
    const [y, m, d] = key.split('-').map(Number) as [number, number, number];
    return dayKey(new Date(y, m - 1, d - 1, 12));
};

/** Pure: consecutive days ending today (or yesterday, so a streak is not lost before you focus today). */
export function computeFocusStreak(days: readonly string[], today: string): number {
    const set = new Set(days);
    let cursor = set.has(today) ? today : previousDay(today);
    let count = 0;
    while (set.has(cursor)) {
        count += 1;
        cursor = previousDay(cursor);
    }
    return count;
}

export function recordFocusDay(now: Date = new Date()): number {
    const today = dayKey(now);
    const days = readDays();
    if (!days.includes(today)) {
        days.push(today);
        try {
            localStorage.setItem(FOCUS_STREAK_STORAGE_KEY, JSON.stringify(days.slice(-MAX_DAYS)));
        } catch {
            // best-effort
        }
    }
    return computeFocusStreak(days, today);
}

export function getFocusStreak(now: Date = new Date()): number {
    return computeFocusStreak(readDays(), dayKey(now));
}
