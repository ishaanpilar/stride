import { getPomodoroLocalDayKey } from './pomodoro';
import type { FocusKeyValueStorage } from './focus-coach-service';

export const FOCUS_STREAK_STORAGE_KEY = 'stride:focus-streak:v1';
const MAX_DAYS = 400;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const dayKey = (date: Date): string => getPomodoroLocalDayKey(date.getTime());

const previousDay = (key: string): string => {
    const [y, m, d] = key.split('-').map(Number) as [number, number, number];
    return dayKey(new Date(y, m - 1, d - 1, 12));
};

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

export function createFocusStreakStore(getStorage: () => Pick<FocusKeyValueStorage, 'getItem' | 'setItem'> | null) {
    const readDays = (): string[] => {
        try {
            const raw = getStorage()?.getItem(FOCUS_STREAK_STORAGE_KEY);
            const parsed: unknown = raw ? JSON.parse(raw) : [];
            if (!Array.isArray(parsed)) return [];
            return Array.from(new Set(parsed.filter((d): d is string => typeof d === 'string' && DAY_PATTERN.test(d)))).sort();
        } catch {
            return [];
        }
    };

    return {
        recordFocusDay(now: Date = new Date()): number {
            const today = dayKey(now);
            const days = readDays();
            if (!days.includes(today)) {
                days.push(today);
                try {
                    getStorage()?.setItem(FOCUS_STREAK_STORAGE_KEY, JSON.stringify(days.slice(-MAX_DAYS)));
                } catch {
                    return computeFocusStreak(days, today);
                }
            }
            return computeFocusStreak(days, today);
        },
        getFocusStreak: (now: Date = new Date()): number => computeFocusStreak(readDays(), dayKey(now)),
    };
}
