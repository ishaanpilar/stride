import { useSyncExternalStore } from 'react';

/**
 * "Keep going when the timer ends" (Settings → GTD → Pomodoro). A behaviour of this Mac, not synced
 * data, so it lives in localStorage (shared by every window of the app). Default on: when a focus
 * session with an open task reaches 0:00 it keeps counting up as overtime instead of ending.
 */
export const POMODORO_KEEP_GOING_STORAGE_KEY = 'stride:pomodoro:keep-going:v1';

const listeners = new Set<() => void>();

export function readPomodoroKeepGoing(): boolean {
    try {
        return localStorage.getItem(POMODORO_KEEP_GOING_STORAGE_KEY) !== 'false';
    } catch {
        return true;
    }
}

export function setPomodoroKeepGoing(enabled: boolean): void {
    try {
        if (enabled) localStorage.removeItem(POMODORO_KEEP_GOING_STORAGE_KEY);
        else localStorage.setItem(POMODORO_KEEP_GOING_STORAGE_KEY, 'false');
    } catch {
        // Storage unavailable: the default (on) stays in effect.
    }
    listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
    listeners.add(listener);
    const onStorage = (event: StorageEvent) => {
        if (event.key === null || event.key === POMODORO_KEEP_GOING_STORAGE_KEY) listener();
    };
    window.addEventListener('storage', onStorage);
    return () => {
        listeners.delete(listener);
        window.removeEventListener('storage', onStorage);
    };
};

export function usePomodoroKeepGoing(): boolean {
    return useSyncExternalStore(subscribe, readPomodoroKeepGoing, () => true);
}
