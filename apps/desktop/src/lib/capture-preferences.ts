import { useSyncExternalStore } from 'react';

/**
 * Per-device capture preferences (microphone behaviour is a property of this Mac, so it is not
 * synced). "Start voice recording when capture opens" lives in the synced GTD setting
 * `defaultCaptureMethod` ('audio' = start recording), shared with Quick Add.
 */

export const CAPTURE_PREFERENCES_STORAGE_KEY = 'stride:capture:prefs:v1';

export type CapturePreferences = {
    /** Save the transcript to the Inbox as soon as transcription finishes (default off). */
    autoSaveAfterTranscription: boolean;
};

export const DEFAULT_CAPTURE_PREFERENCES: CapturePreferences = { autoSaveAfterTranscription: false };

let cached: CapturePreferences | null = null;
const listeners = new Set<() => void>();

function read(): CapturePreferences {
    try {
        const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(CAPTURE_PREFERENCES_STORAGE_KEY);
        if (!raw) return DEFAULT_CAPTURE_PREFERENCES;
        const parsed = JSON.parse(raw) as Partial<CapturePreferences> | null;
        return { autoSaveAfterTranscription: parsed?.autoSaveAfterTranscription === true };
    } catch {
        return DEFAULT_CAPTURE_PREFERENCES;
    }
}

export function getCapturePreferences(): CapturePreferences {
    cached ??= read();
    return cached;
}

export function setCapturePreferences(update: Partial<CapturePreferences>): CapturePreferences {
    const next = { ...getCapturePreferences(), ...update };
    cached = next;
    try {
        localStorage.setItem(CAPTURE_PREFERENCES_STORAGE_KEY, JSON.stringify(next));
    } catch {
        // Private mode or blocked storage: keep the in-memory value for this session.
    }
    listeners.forEach((listener) => listener());
    return next;
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

export function useCapturePreferences(): CapturePreferences {
    return useSyncExternalStore(subscribe, getCapturePreferences, () => DEFAULT_CAPTURE_PREFERENCES);
}

export function resetCapturePreferencesForTests(): void {
    cached = null;
}
