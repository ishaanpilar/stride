import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { getWorkspaceCache } from '../lib/workspace-cache';

/** Per-device width of the main (left) sidebar. */
export const SIDEBAR_WIDTH_STORAGE_KEY = 'stride:sidebar:v1';
export const SIDEBAR_DEFAULT_WIDTH = 256;
export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 420;
/** The sidebar never takes more than this share of the window. */
export const SIDEBAR_MAX_WINDOW_FRACTION = 0.4;
export const SIDEBAR_COLLAPSED_WIDTH = 64;
export const SIDEBAR_KEY_STEP = 16;
export const SIDEBAR_KEY_STEP_LARGE = 64;

/** Largest allowed width for a window this wide (never below the minimum). */
export function getSidebarMaxWidth(windowWidth?: number): number {
    if (typeof windowWidth !== 'number' || !Number.isFinite(windowWidth) || windowWidth <= 0) return SIDEBAR_MAX_WIDTH;
    return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, Math.floor(windowWidth * SIDEBAR_MAX_WINDOW_FRACTION)));
}

/** Clamps any value to [min, max(windowWidth)]; non-numbers become the fallback. */
export function clampSidebarWidth(value: unknown, windowWidth?: number, fallback = SIDEBAR_DEFAULT_WIDTH): number {
    const max = getSidebarMaxWidth(windowWidth);
    const raw = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    return Math.max(SIDEBAR_MIN_WIDTH, Math.min(max, Math.round(raw)));
}

/** Width after a keyboard step on the resize handle, or null when the key isn't a resize key. */
export function getSidebarWidthForKey(
    current: number,
    key: string,
    shiftKey: boolean,
    windowWidth?: number,
): number | null {
    const step = shiftKey ? SIDEBAR_KEY_STEP_LARGE : SIDEBAR_KEY_STEP;
    switch (key) {
        case 'ArrowLeft': return clampSidebarWidth(current - step, windowWidth);
        case 'ArrowRight': return clampSidebarWidth(current + step, windowWidth);
        case 'Home': return SIDEBAR_MIN_WIDTH;
        case 'End': return getSidebarMaxWidth(windowWidth);
        default: return null;
    }
}

export function loadSidebarWidth(): number {
    try {
        const raw = getWorkspaceCache()?.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
        if (!raw) return SIDEBAR_DEFAULT_WIDTH;
        const parsed = JSON.parse(raw) as { width?: unknown } | null;
        return clampSidebarWidth(parsed?.width);
    } catch {
        return SIDEBAR_DEFAULT_WIDTH;
    }
}

function saveSidebarWidth(width: number) {
    try {
        getWorkspaceCache()?.setItem(SIDEBAR_WIDTH_STORAGE_KEY, JSON.stringify({ width }));
    } catch {
        // Persistence is best effort.
    }
}

interface SidebarWidthState {
    /** The user's chosen width (clamped to the absolute range; the window cap is applied at render). */
    width: number;
    setWidth: (width: number) => void;
    reset: () => void;
    /** Re-read persisted state (tests). */
    reload: () => void;
}

export const useSidebarWidthStore = create<SidebarWidthState>((set) => ({
    width: loadSidebarWidth(),
    setWidth: (value) => {
        const width = clampSidebarWidth(value);
        set({ width });
        saveSidebarWidth(width);
    },
    reset: () => {
        set({ width: SIDEBAR_DEFAULT_WIDTH });
        saveSidebarWidth(SIDEBAR_DEFAULT_WIDTH);
    },
    reload: () => set({ width: loadSidebarWidth() }),
}));

const readWindowWidth = () => (typeof window === 'undefined' ? undefined : window.innerWidth);

/** window.innerWidth, updated on resize. */
export function useWindowWidth(): number | undefined {
    const [width, setWidth] = useState(readWindowWidth);
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const update = () => setWidth(readWindowWidth());
        update();
        window.addEventListener('resize', update);
        return () => window.removeEventListener('resize', update);
    }, []);
    return width;
}
