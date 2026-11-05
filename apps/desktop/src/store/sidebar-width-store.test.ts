import { beforeEach, describe, expect, it } from 'vitest';
import {
    SIDEBAR_DEFAULT_WIDTH,
    SIDEBAR_MAX_WIDTH,
    SIDEBAR_MIN_WIDTH,
    SIDEBAR_WIDTH_STORAGE_KEY,
    clampSidebarWidth,
    getSidebarMaxWidth,
    getSidebarWidthForKey,
    loadSidebarWidth,
    useSidebarWidthStore,
} from './sidebar-width-store';

beforeEach(() => {
    window.localStorage.clear();
    useSidebarWidthStore.getState().reload();
});

describe('sidebar width clamp', () => {
    it('clamps to 200..420 and rounds', () => {
        expect(clampSidebarWidth(120)).toBe(SIDEBAR_MIN_WIDTH);
        expect(clampSidebarWidth(9999)).toBe(SIDEBAR_MAX_WIDTH);
        expect(clampSidebarWidth(301.6)).toBe(302);
    });
    it('never exceeds 40% of the window, and never drops below the minimum', () => {
        expect(getSidebarMaxWidth(800)).toBe(320);
        expect(clampSidebarWidth(400, 800)).toBe(320);
        expect(getSidebarMaxWidth(300)).toBe(SIDEBAR_MIN_WIDTH);
        expect(getSidebarMaxWidth(2000)).toBe(SIDEBAR_MAX_WIDTH);
        expect(getSidebarMaxWidth(undefined)).toBe(SIDEBAR_MAX_WIDTH);
    });
    it('uses the default for non-numbers', () => {
        expect(clampSidebarWidth('wide')).toBe(SIDEBAR_DEFAULT_WIDTH);
        expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_DEFAULT_WIDTH);
    });
});

describe('sidebar width keyboard steps', () => {
    it('moves 16px with arrows and 64px with Shift; Home/End jump to the bounds', () => {
        expect(getSidebarWidthForKey(256, 'ArrowRight', false)).toBe(272);
        expect(getSidebarWidthForKey(256, 'ArrowLeft', false)).toBe(240);
        expect(getSidebarWidthForKey(256, 'ArrowRight', true)).toBe(320);
        expect(getSidebarWidthForKey(210, 'ArrowLeft', true)).toBe(SIDEBAR_MIN_WIDTH);
        expect(getSidebarWidthForKey(256, 'Home', false)).toBe(SIDEBAR_MIN_WIDTH);
        expect(getSidebarWidthForKey(256, 'End', false, 900)).toBe(360);
        expect(getSidebarWidthForKey(256, 'ArrowUp', false)).toBeNull();
    });
});

describe('sidebar width persistence', () => {
    it('persists per device and resets to the default', () => {
        useSidebarWidthStore.getState().setWidth(333);
        expect(JSON.parse(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY) ?? '{}')).toEqual({ width: 333 });
        expect(loadSidebarWidth()).toBe(333);
        useSidebarWidthStore.getState().reset();
        expect(useSidebarWidthStore.getState().width).toBe(SIDEBAR_DEFAULT_WIDTH);
        expect(loadSidebarWidth()).toBe(SIDEBAR_DEFAULT_WIDTH);
    });
    it('ignores corrupt or out-of-range stored values', () => {
        window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, '{not json');
        expect(loadSidebarWidth()).toBe(SIDEBAR_DEFAULT_WIDTH);
        window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, JSON.stringify({ width: 5000 }));
        expect(loadSidebarWidth()).toBe(SIDEBAR_MAX_WIDTH);
    });
});
