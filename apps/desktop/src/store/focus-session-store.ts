import { create } from 'zustand';
import { getWorkspaceCache } from '../lib/workspace-cache';

/**
 * UI state for the focus session. The timer itself (running, phase, selected task) stays in the
 * pomodoro store, so the main window, the menu bar panel and this store never duplicate it.
 *
 * One session, three presentations:
 * - `full`: the immersive stage. The app behind it is dimmed and inert.
 * - `mini`: Minimise (or Esc). A small floating card over the normal app with time, task, current
 *   step, pause, expand and close. It can be dragged; its position is remembered.
 * - `hidden`: Close (X). Nothing on screen but a small pill in the corner; the timer keeps running.
 *   The pill and the Today card both lead back to the stage.
 * Ending a running session (the stop button) asks first and stops the timer.
 */
export type FocusPresentation = 'full' | 'mini' | 'hidden';
export type FocusShellMode = 'focus' | 'break' | undefined;
/** Viewport rect the stage grows out of (the task row or the card that started it). */
export type FocusOrigin = { x: number; y: number; width: number; height: number };
/** Mini card offset from the bottom-right corner of the window, in px. */
export type FocusMiniPosition = { right: number; bottom: number };

/** Shared with the menu bar panel window (same storage), so it can offer "Back to focus". */
export const FOCUS_PRESENTATION_STORAGE_KEY = 'stride:focus:presentation:v1';
export const FOCUS_MINI_POSITION_STORAGE_KEY = 'stride:focus:mini-position:v1';
export const DEFAULT_MINI_POSITION: FocusMiniPosition = { right: 20, bottom: 20 };

export type FocusSessionState = {
    open: boolean;
    presentation: FocusPresentation;
    /** The presentation the session came from, for the shrink/grow transition. */
    previous: FocusPresentation | null;
    confirmingEnd: boolean;
    /** The user left on purpose: do not auto-reopen until the timer stops or a new one starts. */
    dismissed: boolean;
    stepsDoneAtStart: number;
    origin: FocusOrigin | null;
    miniPosition: FocusMiniPosition;
    open_: (stepsDone: number) => void;
    setOrigin: (origin: FocusOrigin | null) => void;
    minimise: () => void;
    hide: () => void;
    expand: () => void;
    /** Returns true if the session ended at once, false if a confirmation is now showing. */
    requestEnd: (timerRunning: boolean) => boolean;
    cancelEnd: () => void;
    close: () => void;
    clearDismissed: () => void;
    setMiniPosition: (position: FocusMiniPosition) => void;
};

const isPresentation = (value: unknown): value is FocusPresentation => value === 'full' || value === 'mini' || value === 'hidden';

export function readStoredPresentation(): FocusPresentation | null {
    try {
        const value = getWorkspaceCache()?.getItem(FOCUS_PRESENTATION_STORAGE_KEY);
        return isPresentation(value) ? value : null;
    } catch {
        return null;
    }
}

const writePresentation = (value: FocusPresentation | null) => {
    try {
        const cache = getWorkspaceCache();
        if (!cache) return;
        if (value) cache.setItem(FOCUS_PRESENTATION_STORAGE_KEY, value);
        else cache.removeItem(FOCUS_PRESENTATION_STORAGE_KEY);
    } catch {
        // Storage can be unavailable (private mode); the session still works in memory.
    }
};

export function clampMiniPosition(position: FocusMiniPosition, viewport: { width: number; height: number }, size = { width: 320, height: 120 }): FocusMiniPosition {
    const maxRight = Math.max(8, viewport.width - size.width - 8);
    const maxBottom = Math.max(8, viewport.height - size.height - 8);
    const clamp = (value: number, max: number) => Math.min(max, Math.max(8, Number.isFinite(value) ? value : 8));
    return { right: Math.round(clamp(position.right, maxRight)), bottom: Math.round(clamp(position.bottom, maxBottom)) };
}

const readMiniPosition = (): FocusMiniPosition => {
    try {
        const raw = getWorkspaceCache()?.getItem(FOCUS_MINI_POSITION_STORAGE_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        if (parsed && typeof parsed === 'object') {
            const { right, bottom } = parsed as Record<string, unknown>;
            if (typeof right === 'number' && typeof bottom === 'number' && Number.isFinite(right) && Number.isFinite(bottom)) {
                return { right: Math.max(8, right), bottom: Math.max(8, bottom) };
            }
        }
    } catch {
        // Fall through to the default corner.
    }
    return DEFAULT_MINI_POSITION;
};

const closedState = {
    open: false,
    presentation: 'full' as FocusPresentation,
    previous: null,
    confirmingEnd: false,
    dismissed: false,
    stepsDoneAtStart: 0,
    origin: null,
};

export const useFocusSessionStore = create<FocusSessionState>((set, get) => {
    const present = (presentation: FocusPresentation) => {
        if (!get().open) return;
        writePresentation(presentation);
        set({ presentation, previous: get().presentation, confirmingEnd: false });
    };
    return {
        ...closedState,
        // A reload while a session runs keeps the presentation the user chose.
        presentation: readStoredPresentation() ?? 'full',
        miniPosition: readMiniPosition(),
        open_: (stepsDone) => {
            const presentation = get().presentation;
            writePresentation(presentation);
            set({ open: true, presentation, previous: null, confirmingEnd: false, dismissed: false, stepsDoneAtStart: stepsDone });
        },
        setOrigin: (origin) => set({ origin }),
        minimise: () => present('mini'),
        hide: () => present('hidden'),
        expand: () => present('full'),
        requestEnd: (timerRunning) => {
            if (timerRunning) {
                if (get().presentation !== 'full') writePresentation('full');
                set({ confirmingEnd: true, presentation: 'full', previous: get().presentation });
                return false;
            }
            get().close();
            return true;
        },
        cancelEnd: () => set({ confirmingEnd: false }),
        close: () => {
            writePresentation(null);
            set({ ...closedState, dismissed: true });
        },
        clearDismissed: () => set({ dismissed: false }),
        setMiniPosition: (position) => {
            try {
                getWorkspaceCache()?.setItem(FOCUS_MINI_POSITION_STORAGE_KEY, JSON.stringify(position));
            } catch {
                // Position is a convenience; keep it in memory.
            }
            set({ miniPosition: position });
        },
    };
});

export const resetFocusSessionStore = () => {
    writePresentation(null);
    useFocusSessionStore.setState({ ...closedState, miniPosition: DEFAULT_MINI_POSITION });
};

export function getFocusShellMode(
    session: Pick<FocusSessionState, 'open' | 'presentation'>,
    phase: 'focus' | 'break',
): FocusShellMode {
    if (!session.open || session.presentation !== 'full') return undefined;
    return phase === 'break' ? 'break' : 'focus';
}
