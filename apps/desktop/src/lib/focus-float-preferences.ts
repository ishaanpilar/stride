import { useSyncExternalStore } from 'react';

/**
 * Device-local preference for the floating focus timer. It is a window behaviour of this Mac,
 * not synced data, so it lives in localStorage (shared by every window of the app).
 */
export const FOCUS_FLOAT_AUTO_SHOW_STORAGE_KEY = 'stride:focus:float-auto-show:v1';

const listeners = new Set<() => void>();

export function readFocusFloatAutoShow(): boolean {
    try {
        return localStorage.getItem(FOCUS_FLOAT_AUTO_SHOW_STORAGE_KEY) !== 'false';
    } catch {
        return true;
    }
}

export function setFocusFloatAutoShow(enabled: boolean): void {
    try {
        if (enabled) localStorage.removeItem(FOCUS_FLOAT_AUTO_SHOW_STORAGE_KEY);
        else localStorage.setItem(FOCUS_FLOAT_AUTO_SHOW_STORAGE_KEY, 'false');
    } catch {
        // Storage unavailable: the default (on) stays in effect.
    }
    listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
    listeners.add(listener);
    const onStorage = (event: StorageEvent) => {
        if (event.key === null || event.key === FOCUS_FLOAT_AUTO_SHOW_STORAGE_KEY) listener();
    };
    window.addEventListener('storage', onStorage);
    return () => {
        listeners.delete(listener);
        window.removeEventListener('storage', onStorage);
    };
};

/** "Show floating timer while a session runs" (default on). */
export function useFocusFloatAutoShow(): boolean {
    return useSyncExternalStore(subscribe, readFocusFloatAutoShow, () => true);
}
