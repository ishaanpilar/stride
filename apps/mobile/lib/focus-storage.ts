import {
    FOCUS_COACH_FEEDBACK_STORAGE_KEY,
    FOCUS_NOW_STORAGE_KEY,
    FOCUS_STREAK_STORAGE_KEY,
    createFocusCoachStore,
    createFocusStreakStore,
    type FocusKeyValueStorage,
} from '@stride/core';
import { workspaceSessionStorage } from './workspace-session-storage';

const KEYS = [FOCUS_COACH_FEEDBACK_STORAGE_KEY, FOCUS_NOW_STORAGE_KEY, FOCUS_STREAK_STORAGE_KEY];
const memory = new Map<string, string>();
let hydration: Promise<void> | null = null;

const persist = (work: Promise<void>) => { void work.catch(() => undefined); };

export const focusStorage: FocusKeyValueStorage = {
    getItem: (key) => memory.get(key) ?? null,
    setItem(key, value) {
        memory.set(key, value);
        persist(workspaceSessionStorage.setItem(key, value));
    },
    removeItem(key) {
        memory.delete(key);
        persist(workspaceSessionStorage.removeItem(key));
    },
};

export function hydrateFocusStorage(): Promise<void> {
    hydration ??= Promise.all(KEYS.map(async (key) => {
        const value = await workspaceSessionStorage.getItem(key).catch(() => null);
        if (value !== null && !memory.has(key)) memory.set(key, value);
    })).then(() => undefined);
    return hydration;
}

export const resetFocusStorageForTests = () => {
    memory.clear();
    hydration = null;
};

export const focusCoachStore = createFocusCoachStore(() => focusStorage);
export const focusStreakStore = createFocusStreakStore(() => focusStorage);
