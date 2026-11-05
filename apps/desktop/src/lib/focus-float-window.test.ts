import { describe, expect, it } from 'vitest';
import {
    deriveFocusFloatDisplay,
    focusFloatStateChanged,
    isFocusFloatLocation,
    shouldShowFocusFloat,
    type FocusFloatState,
    type FocusFloatVisibilityInput,
} from './focus-float-window';

const T0 = 1_800_000_000_000;

const running = (overrides: Partial<FocusFloatState> = {}): FocusFloatState => ({
    timer: { phase: 'focus', remainingSeconds: 600, isRunning: true, completedFocusSessions: 0 },
    durations: { focusMinutes: 25, breakMinutes: 5 },
    updatedAtMs: T0,
    autoStart: {},
    view: 'focus',
    taskTitle: 'Send Rhea the photos',
    currentStep: 'Pick the best ten',
    nextStep: 'Upload to the album',
    ...overrides,
});

describe('isFocusFloatLocation', () => {
    it('recognises the float window query', () => {
        expect(isFocusFloatLocation({ search: '?focusFloat=1' })).toBe(true);
        expect(isFocusFloatLocation({ search: '?focusFloat=true' })).toBe(true);
        expect(isFocusFloatLocation({ search: '?menubarPanel=1' })).toBe(false);
        expect(isFocusFloatLocation({ search: '' })).toBe(false);
    });
});

describe('deriveFocusFloatDisplay', () => {
    it('counts down from the state timestamp, not from its own clock', () => {
        const state = running();
        expect(deriveFocusFloatDisplay(state, T0).remainingSeconds).toBe(600);
        expect(deriveFocusFloatDisplay(state, T0 + 999).remainingSeconds).toBe(600);
        expect(deriveFocusFloatDisplay(state, T0 + 1000).remainingSeconds).toBe(599);
        // An hour of renders later still lands on the exact second: no drift.
        expect(deriveFocusFloatDisplay(state, T0 + 61_500).remainingSeconds).toBe(539);
        expect(deriveFocusFloatDisplay(state, T0 + 61_500).progress).toBeCloseTo(1 - 539 / 1500);
    });

    it('a paused timer stands still', () => {
        const state = running({ timer: { phase: 'focus', remainingSeconds: 264, isRunning: false, completedFocusSessions: 0 } });
        const display = deriveFocusFloatDisplay(state, T0 + 90_000);
        expect(display.remainingSeconds).toBe(264);
        expect(display.isRunning).toBe(false);
        expect(display.view).toBe('focus');
        expect(display.crossed).toBeNull();
    });

    it('a break shows the break view and break length', () => {
        const state = running({ timer: { phase: 'break', remainingSeconds: 120, isRunning: true, completedFocusSessions: 1 }, view: 'break' });
        const display = deriveFocusFloatDisplay(state, T0 + 1000);
        expect(display.view).toBe('break');
        expect(display.totalSeconds).toBe(300);
        expect(display.remainingSeconds).toBe(119);
    });

    it('reaching zero shows the finished session and reports the crossing once', () => {
        const state = running({ timer: { phase: 'focus', remainingSeconds: 3, isRunning: true, completedFocusSessions: 0 } });
        const display = deriveFocusFloatDisplay(state, T0 + 4000);
        expect(display.view).toBe('finish');
        expect(display.crossed).toBe('focus-finished');
        expect(display.phase).toBe('break');
    });

    it('keeps the main window views for finished and ready', () => {
        const finished = running({ timer: { phase: 'break', remainingSeconds: 300, isRunning: false, completedFocusSessions: 1 }, view: 'finish' });
        expect(deriveFocusFloatDisplay(finished, T0 + 5000).view).toBe('finish');
        const ready = running({ timer: { phase: 'focus', remainingSeconds: 1500, isRunning: false, completedFocusSessions: 1 }, view: 'ready' });
        expect(deriveFocusFloatDisplay(ready, T0 + 5000).view).toBe('ready');
    });
});

describe('focusFloatStateChanged', () => {
    it('ignores the countdown ticking but sees everything else', () => {
        const first = running();
        const tick = running({ timer: { ...first.timer, remainingSeconds: 599 }, updatedAtMs: T0 + 1000 });
        const later = running({ timer: { ...first.timer, remainingSeconds: 540 }, updatedAtMs: T0 + 60_000 });
        expect(focusFloatStateChanged(null, first)).toBe(true);
        expect(focusFloatStateChanged(first, tick)).toBe(false);
        expect(focusFloatStateChanged(first, later)).toBe(false);
        expect(focusFloatStateChanged(first, running({ timer: { ...first.timer, isRunning: false } }))).toBe(true);
        expect(focusFloatStateChanged(first, running({ view: 'finish' }))).toBe(true);
        expect(focusFloatStateChanged(first, running({ currentStep: 'Upload to the album' }))).toBe(true);
        expect(focusFloatStateChanged(first, running({ taskTitle: null }))).toBe(true);
        // Remaining time jumped (a reset or a new session) without the clock explaining it.
        expect(focusFloatStateChanged(first, running({ timer: { ...first.timer, remainingSeconds: 1500 }, updatedAtMs: T0 + 1000 }))).toBe(true);
    });
});

describe('shouldShowFocusFloat (auto-show rule)', () => {
    const base: FocusFloatVisibilityInput = {
        supported: true,
        live: true,
        presentation: 'full',
        mainActive: false,
        autoShow: true,
        requested: false,
        closedByUser: false,
    };

    it('shows automatically while a session runs and you are in another app (or Stride is hidden)', () => {
        expect(shouldShowFocusFloat(base)).toBe(true);
        expect(shouldShowFocusFloat({ ...base, presentation: 'hidden' })).toBe(true);
    });

    it('stays away while the full stage is in front of you', () => {
        expect(shouldShowFocusFloat({ ...base, mainActive: true })).toBe(false);
        expect(shouldShowFocusFloat({ ...base, mainActive: true, requested: true })).toBe(false);
    });

    it('shows when minimised inside Stride (the float replaces the mini card)', () => {
        expect(shouldShowFocusFloat({ ...base, mainActive: true, presentation: 'mini' })).toBe(true);
    });

    it('with the setting off, only when asked for', () => {
        expect(shouldShowFocusFloat({ ...base, autoShow: false })).toBe(false);
        expect(shouldShowFocusFloat({ ...base, autoShow: false, requested: true })).toBe(true);
    });

    it('never after the user closed it, without a session, or where unsupported', () => {
        expect(shouldShowFocusFloat({ ...base, closedByUser: true })).toBe(false);
        expect(shouldShowFocusFloat({ ...base, live: false, requested: true })).toBe(false);
        expect(shouldShowFocusFloat({ ...base, supported: false, requested: true })).toBe(false);
    });
});
