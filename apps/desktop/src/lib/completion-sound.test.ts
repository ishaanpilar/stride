import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    COMPLETION_SOUND_STORAGE_KEY,
    isCompletionSoundEnabled,
    playCompletionSound,
    resetCompletionSoundForTests,
    setCompletionSoundEnabled,
} from './completion-sound';

describe('completion sound setting', () => {
    beforeEach(() => {
        window.localStorage.clear();
        resetCompletionSoundForTests();
    });
    afterEach(() => vi.unstubAllGlobals());

    it('is on by default', () => {
        expect(isCompletionSoundEnabled()).toBe(true);
    });

    it('persists off and on across reloads', () => {
        setCompletionSoundEnabled(false);
        expect(window.localStorage.getItem(COMPLETION_SOUND_STORAGE_KEY)).toBe('off');
        resetCompletionSoundForTests();
        expect(isCompletionSoundEnabled()).toBe(false);
        setCompletionSoundEnabled(true);
        expect(window.localStorage.getItem(COMPLETION_SOUND_STORAGE_KEY)).toBeNull();
        resetCompletionSoundForTests();
        expect(isCompletionSoundEnabled()).toBe(true);
    });

    it('does not create audio when off', () => {
        const ctor = vi.fn();
        vi.stubGlobal('AudioContext', ctor);
        setCompletionSoundEnabled(false);
        expect(playCompletionSound()).toBe(false);
        expect(ctor).not.toHaveBeenCalled();
    });

    it('is a no-op without WebAudio', () => {
        vi.stubGlobal('AudioContext', undefined);
        expect(playCompletionSound()).toBe(false);
    });
});
