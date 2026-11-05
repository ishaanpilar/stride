import { beforeEach, describe, expect, it } from 'vitest';
import {
    clampMiniPosition,
    FOCUS_MINI_POSITION_STORAGE_KEY,
    FOCUS_PRESENTATION_STORAGE_KEY,
    getFocusShellMode,
    readStoredPresentation,
    resetFocusSessionStore,
    useFocusSessionStore,
} from './focus-session-store';

const s = () => useFocusSessionStore.getState();

describe('focus session presentation model', () => {
    beforeEach(() => {
        localStorage.clear();
        resetFocusSessionStore();
    });

    it('dims the shell only while the full stage is up', () => {
        expect(getFocusShellMode(s(), 'focus')).toBeUndefined();
        s().open_(2);
        expect(s().stepsDoneAtStart).toBe(2);
        expect(getFocusShellMode(s(), 'focus')).toBe('focus');
        expect(getFocusShellMode(s(), 'break')).toBe('break');
        s().minimise();
        expect(s().presentation).toBe('mini');
        expect(getFocusShellMode(s(), 'focus')).toBeUndefined();
        s().hide();
        expect(s().presentation).toBe('hidden');
        expect(s().previous).toBe('mini');
        expect(getFocusShellMode(s(), 'focus')).toBeUndefined();
        s().expand();
        expect(getFocusShellMode(s(), 'focus')).toBe('focus');
        expect(s().open).toBe(true);
    });

    it('shares the presentation with the menu bar panel and clears it when the session ends', () => {
        s().open_(0);
        expect(readStoredPresentation()).toBe('full');
        s().minimise();
        expect(localStorage.getItem(FOCUS_PRESENTATION_STORAGE_KEY)).toBe('mini');
        s().close();
        expect(readStoredPresentation()).toBeNull();
        expect(s().presentation).toBe('full');
    });

    it('does nothing to the presentation without an open session', () => {
        s().minimise();
        expect(s().presentation).toBe('full');
        expect(readStoredPresentation()).toBeNull();
    });

    it('asks before ending a running session (and brings the stage back to ask)', () => {
        s().open_(0);
        s().hide();
        expect(s().requestEnd(true)).toBe(false);
        expect(s().confirmingEnd).toBe(true);
        expect(s().presentation).toBe('full');
        s().cancelEnd();
        expect(s().open).toBe(true);
        expect(s().requestEnd(false)).toBe(true);
        expect(s().open).toBe(false);
        expect(s().dismissed).toBe(true);
        s().clearDismissed();
        expect(s().dismissed).toBe(false);
    });

    it('remembers where the mini card was dragged, kept on screen', () => {
        s().setMiniPosition({ right: 140, bottom: 90 });
        expect(JSON.parse(localStorage.getItem(FOCUS_MINI_POSITION_STORAGE_KEY)!)).toEqual({ right: 140, bottom: 90 });
        expect(clampMiniPosition({ right: 5000, bottom: -40 }, { width: 1200, height: 800 }, { width: 320, height: 120 }))
            .toEqual({ right: 872, bottom: 8 });
        expect(clampMiniPosition({ right: Number.NaN, bottom: 30 }, { width: 1200, height: 800 })).toEqual({ right: 8, bottom: 30 });
    });
});
