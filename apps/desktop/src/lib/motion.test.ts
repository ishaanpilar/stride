import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import {
    MOTION_STORAGE_KEY,
    applyMotionPreference,
    canAnimate,
    coerceMotionPreference,
    getMotionDiagnostics,
    getMotionPreference,
    installMotionPreference,
    isMotionEnabled,
    motionDuration,
    resetMotionPreferenceForTests,
    resolveMotionEnabled,
    setMotionPreference,
    useMotionEnabled,
    useMotionPreference,
} from './motion';

type MediaListener = (event: MediaQueryListEvent) => void;

function mockReducedMotion(initial: boolean) {
    const listeners = new Set<MediaListener>();
    const media = {
        matches: initial,
        media: '(prefers-reduced-motion: reduce)',
        addEventListener: (_type: string, listener: MediaListener) => listeners.add(listener),
        removeEventListener: (_type: string, listener: MediaListener) => listeners.delete(listener),
    };
    Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: vi.fn(() => media) });
    return {
        set(matches: boolean) {
            media.matches = matches;
            listeners.forEach((listener) => listener({ matches } as MediaQueryListEvent));
        },
    };
}

function stubWebAnimations() {
    Object.defineProperty(Element.prototype, 'animate', {
        configurable: true,
        writable: true,
        value: vi.fn(() => ({ finished: Promise.resolve(), cancel: vi.fn() })),
    });
}

const root = () => document.documentElement;

describe('motion preference', () => {
    beforeEach(() => {
        localStorage.clear();
        resetMotionPreferenceForTests();
    });

    afterEach(() => {
        resetMotionPreferenceForTests();
        Reflect.deleteProperty(window, 'matchMedia');
        Reflect.deleteProperty(Element.prototype, 'animate');
    });

    it('coerces unknown stored values to on', () => {
        expect(coerceMotionPreference(null)).toBe('on');
        expect(coerceMotionPreference('bogus')).toBe('on');
        expect(coerceMotionPreference('off')).toBe('off');
    });

    it('resolves motion from the preference and the system setting', () => {
        expect(resolveMotionEnabled('on', false)).toBe(true);
        expect(resolveMotionEnabled('on', true)).toBe(false);
        expect(resolveMotionEnabled('off', false)).toBe(false);
    });

    it('applies the stored preference to <html> at startup', () => {
        localStorage.setItem(MOTION_STORAGE_KEY, 'off');
        installMotionPreference();
        expect(root().dataset.motion).toBe('off');
        expect(root().dataset.motionPreference).toBe('off');
        expect(getMotionPreference()).toBe('off');
    });

    it('defaults to on with no stored preference', () => {
        installMotionPreference();
        expect(root().dataset.motion).toBe('on');
        expect(isMotionEnabled()).toBe(true);
    });

    it('is on by default with no stored setting, no system preference and no matchMedia at all', () => {
        expect(localStorage.getItem(MOTION_STORAGE_KEY)).toBeNull();
        installMotionPreference();
        expect(getMotionPreference()).toBe('on');
        expect(getMotionDiagnostics()).toEqual({ preference: 'on', systemReduced: false, enabled: true, reason: 'on' });
        expect(root().dataset.motionReason).toBe('on');
        stubWebAnimations();
        expect(canAnimate()).toBe(true);
    });

    it('treats a throwing matchMedia (some embedded webviews) as "no reduced motion"', () => {
        Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: () => { throw new Error('unsupported'); } });
        installMotionPreference();
        expect(root().dataset.motion).toBe('on');
    });

    it('says why motion is off: the setting or the system', () => {
        mockReducedMotion(true);
        installMotionPreference();
        expect(root().dataset.motionReason).toBe('system-reduced');
        setMotionPreference('off');
        expect(root().dataset.motionReason).toBe('setting-off');
    });

    it('persists the preference and updates the attribute immediately', () => {
        installMotionPreference();
        setMotionPreference('off');
        expect(localStorage.getItem(MOTION_STORAGE_KEY)).toBe('off');
        expect(root().dataset.motion).toBe('off');

        setMotionPreference('on');
        expect(localStorage.getItem(MOTION_STORAGE_KEY)).toBeNull();
        expect(root().dataset.motion).toBe('on');
    });

    it('turns motion off while the system asks for reduced motion and follows changes', () => {
        const media = mockReducedMotion(true);
        installMotionPreference();
        expect(root().dataset.motion).toBe('off');
        expect(root().dataset.motionPreference).toBe('on');

        act(() => media.set(false));
        expect(root().dataset.motion).toBe('on');
    });

    it('follows a preference changed in another window', () => {
        installMotionPreference();
        localStorage.setItem(MOTION_STORAGE_KEY, 'off');
        window.dispatchEvent(new StorageEvent('storage', { key: MOTION_STORAGE_KEY }));
        expect(root().dataset.motion).toBe('off');
    });

    it('only animates from JS when the Web Animations API exists and motion is on', () => {
        installMotionPreference();
        expect(canAnimate()).toBe(false);
        expect(motionDuration(200)).toBe(0);

        stubWebAnimations();
        expect(canAnimate()).toBe(true);
        expect(motionDuration(200)).toBe(200);

        setMotionPreference('off');
        expect(canAnimate()).toBe(false);
        expect(motionDuration(200)).toBe(0);
    });

    it('re-renders hooks when the preference changes', () => {
        installMotionPreference();
        const preference = renderHook(() => useMotionPreference());
        const enabled = renderHook(() => useMotionEnabled());
        expect(preference.result.current[0]).toBe('on');
        expect(enabled.result.current).toBe(true);

        act(() => preference.result.current[1]('off'));
        expect(preference.result.current[0]).toBe('off');
        expect(enabled.result.current).toBe(false);
    });

    it('writes the resolved state without a stored preference', () => {
        expect(applyMotionPreference('off')).toBe(false);
        expect(root().dataset.motion).toBe('off');
    });
});
