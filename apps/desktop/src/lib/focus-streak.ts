import { computeFocusStreak, createFocusStreakStore, FOCUS_STREAK_STORAGE_KEY } from '@stride/core';

export { computeFocusStreak, FOCUS_STREAK_STORAGE_KEY };

const store = createFocusStreakStore(() => (typeof localStorage === 'undefined' ? null : localStorage));

export const recordFocusDay = store.recordFocusDay;
export const getFocusStreak = store.getFocusStreak;
