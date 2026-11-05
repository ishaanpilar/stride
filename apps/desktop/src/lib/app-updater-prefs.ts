import { comparePromptVersions } from '@stride/core';

export const APP_UPDATER_PREFS_KEY = 'stride:app-updater:v1';

export type WhatsNewEntry = {
    version: string;
    notes: string;
};

export type AppUpdaterPrefs = {
    autoCheck?: boolean;
    lastCheckedAt?: string;
    pendingWhatsNew?: WhatsNewEntry;
    whatsNewShownVersion?: string;
};

function getStorage(): Storage | null {
    if (typeof window === 'undefined') return null;
    try {
        return window.localStorage;
    } catch {
        return null;
    }
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
    Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

export function readAppUpdaterPrefs(storage = getStorage()): AppUpdaterPrefs {
    if (!storage) return {};
    try {
        const raw = storage.getItem(APP_UPDATER_PREFS_KEY);
        if (!raw) return {};
        const parsed: unknown = JSON.parse(raw);
        return isRecord(parsed) ? parsed as AppUpdaterPrefs : {};
    } catch {
        return {};
    }
}

export function updateAppUpdaterPrefs(
    updater: (prefs: AppUpdaterPrefs) => AppUpdaterPrefs,
    storage = getStorage(),
): AppUpdaterPrefs {
    const next = updater(readAppUpdaterPrefs(storage));
    if (!storage) return next;
    try {
        storage.setItem(APP_UPDATER_PREFS_KEY, JSON.stringify(next));
    } catch {
        return next;
    }
    return next;
}

export const isAutoUpdateCheckEnabled = (prefs: AppUpdaterPrefs): boolean => prefs.autoCheck !== false;

export function resolveWhatsNew(prefs: AppUpdaterPrefs, currentVersion: string): WhatsNewEntry | null {
    const pending = prefs.pendingWhatsNew;
    if (!pending?.version) return null;
    if (comparePromptVersions(pending.version, currentVersion) !== 0) return null;
    if (prefs.whatsNewShownVersion && comparePromptVersions(prefs.whatsNewShownVersion, currentVersion) === 0) {
        return null;
    }
    return pending;
}

const withoutPendingWhatsNew = (prefs: AppUpdaterPrefs): AppUpdaterPrefs => {
    const next = { ...prefs };
    delete next.pendingWhatsNew;
    return next;
};

export function recordWhatsNewShown(prefs: AppUpdaterPrefs, currentVersion: string): AppUpdaterPrefs {
    return { ...withoutPendingWhatsNew(prefs), whatsNewShownVersion: currentVersion };
}

export function clearStaleWhatsNew(prefs: AppUpdaterPrefs, currentVersion: string): AppUpdaterPrefs {
    const pending = prefs.pendingWhatsNew;
    if (!pending?.version) return prefs;
    if (comparePromptVersions(pending.version, currentVersion) >= 0) return prefs;
    return withoutPendingWhatsNew(prefs);
}
