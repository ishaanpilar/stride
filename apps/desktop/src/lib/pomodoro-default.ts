import { useTaskStore } from '@stride/core';

/**
 * Stride turns Pomodoro on by default. Core treats a missing `features.pomodoro` as off (the phone
 * apps and their parity fixtures rely on that), so the desktop app writes `true` once when the user
 * has never chosen. An explicit `false` is never overridden. The setting syncs like any other.
 */
export async function enablePomodoroByDefault(store: typeof useTaskStore = useTaskStore): Promise<boolean> {
    const settings = store.getState().settings;
    if (settings?.features?.pomodoro !== undefined) return false;
    await store.getState().updateSettings({ features: { ...(settings?.features ?? {}), pomodoro: true } });
    return true;
}
