import { useEffect, useRef, useState } from 'react';
import { isSandboxMode, POMODORO_ADJUST_STEP_MINUTES } from '@stride/core';
import {
    FOCUS_FLOAT_ACTION_EVENT,
    FOCUS_FLOAT_OPEN_EVENT,
    FOCUS_FLOAT_REQUEST_EVENT,
    focusFloatStateChanged,
    hideFocusFloat,
    sendFocusFloatState,
    shouldShowFocusFloat,
    showFocusFloat,
    type FocusFloatAction,
    type FocusFloatState,
} from '../../lib/focus-float-window';
import { useFocusFloatAutoShow } from '../../lib/focus-float-preferences';
import { logWarn } from '../../lib/app-log';
import { useAppLockStore } from '../../lib/app-lock';
import { isTauriRuntime } from '../../lib/runtime';
import { useFocusFloatStore } from '../../store/focus-float-store';
import type { FocusPresentation } from '../../store/focus-session-store';

/** A blur shorter than this (a native dialog, a click on the float) does not pop the float up. */
const INACTIVE_DELAY_MS = 350;

export type FocusFloatHandlers = {
    toggle: () => void;
    /** Bring the full Focus stage back (the main window is already being shown by Rust). */
    open: () => void;
    startNext: () => void;
    /** Catch up with a phase that ended while this window may have been throttled. */
    tick: () => void;
    /** The float's "−" / "+": change the current phase by that many minutes. */
    adjust: (deltaMinutes: number) => void;
};

const isMainActive = () => (
    typeof document !== 'undefined' && document.visibilityState === 'visible' && document.hasFocus()
);

/** Is the main window visible and focused? Going inactive is debounced; coming back is immediate. */
export function useMainWindowActive(): boolean {
    const [active, setActive] = useState(isMainActive);
    useEffect(() => {
        let timer: number | undefined;
        const update = () => {
            window.clearTimeout(timer);
            if (isMainActive()) {
                setActive(true);
                return;
            }
            timer = window.setTimeout(() => setActive(isMainActive()), INACTIVE_DELAY_MS);
        };
        window.addEventListener('focus', update);
        window.addEventListener('blur', update);
        document.addEventListener('visibilitychange', update);
        return () => {
            window.clearTimeout(timer);
            window.removeEventListener('focus', update);
            window.removeEventListener('blur', update);
            document.removeEventListener('visibilitychange', update);
        };
    }, []);
    return active;
}

export const isFocusFloatSupported = () => isTauriRuntime() && !isSandboxMode();

/**
 * Main-window side of the floating timer: decides when the native float is on screen, pushes
 * state to it when something other than the countdown changes, and runs the float's buttons.
 */
export function useFocusFloatBridge({
    state,
    live,
    presentation,
    handlers,
}: {
    state: FocusFloatState | null;
    live: boolean;
    presentation: FocusPresentation;
    handlers: FocusFloatHandlers;
}): void {
    const supported = isFocusFloatSupported();
    const mainActive = useMainWindowActive();
    const autoShow = useFocusFloatAutoShow();
    const requested = useFocusFloatStore((s) => s.requested);
    const closedByUser = useFocusFloatStore((s) => s.closedByUser);
    const visible = useFocusFloatStore((s) => s.visible);
    // While Stride is locked the float keeps the time but not what you are working on.
    const locked = useAppLockStore((s) => s.locked);
    const shown = state && locked ? { ...state, taskTitle: null, currentStep: null, nextStep: null } : state;
    const handlersRef = useRef(handlers);
    handlersRef.current = handlers;
    const stateRef = useRef(shown);
    stateRef.current = shown;
    const sentRef = useRef<FocusFloatState | null>(null);

    const send = (next: FocusFloatState | null, force = false) => {
        if (!next || (!force && !focusFloatStateChanged(sentRef.current, next))) return;
        sentRef.current = next;
        sendFocusFloatState(next).catch((error) => {
            sentRef.current = null;
            void logWarn('Floating timer: state not delivered', { scope: 'focus', extra: { error: String(error) } });
        });
    };

    // A session ended: forget this session's float choices.
    useEffect(() => {
        if (!live) useFocusFloatStore.getState().resetSession();
    }, [live]);

    const desired = shouldShowFocusFloat({ supported, live, presentation, mainActive, autoShow, requested, closedByUser });
    useEffect(() => {
        if (!supported || desired === visible) return;
        let cancelled = false;
        if (desired) {
            // Send state first so the float never paints an empty frame.
            send(stateRef.current, true);
            showFocusFloat()
                .then(() => {
                    // Not wanted any more by the time it appeared: take it down again.
                    if (cancelled) void hideFocusFloat().catch(() => undefined);
                    else useFocusFloatStore.getState().setVisible(true);
                })
                .catch((error) => void logWarn('Floating timer: show failed', { scope: 'focus', extra: { error: String(error) } }));
        } else {
            useFocusFloatStore.getState().setVisible(false);
            hideFocusFloat().catch((error) => void logWarn('Floating timer: hide failed', { scope: 'focus', extra: { error: String(error) } }));
        }
        return () => { cancelled = true; };
    }, [desired, supported, visible]);

    useEffect(() => {
        if (visible) send(shown);
    }, [shown, visible]);

    useEffect(() => {
        if (!supported) return;
        let disposed = false;
        const offs: Array<() => void> = [];
        const setup = async () => {
            const { listen } = await import('@tauri-apps/api/event');
            const offAction = await listen<{ action?: FocusFloatAction }>(FOCUS_FLOAT_ACTION_EVENT, (event) => {
                const action = event.payload?.action;
                const run = handlersRef.current;
                if (action === 'toggle') run.toggle();
                else if (action === 'start-next') run.startNext();
                else if (action === 'tick') run.tick();
                else if (action === 'add-time') run.adjust(POMODORO_ADJUST_STEP_MINUTES);
                else if (action === 'remove-time') run.adjust(-POMODORO_ADJUST_STEP_MINUTES);
                else if (action === 'sync') send(stateRef.current, true);
                else if (action === 'close') {
                    useFocusFloatStore.getState().closeByUser();
                    useFocusFloatStore.getState().setVisible(false);
                }
            });
            const offOpen = await listen(FOCUS_FLOAT_OPEN_EVENT, () => handlersRef.current.open());
            const offRequest = await listen(FOCUS_FLOAT_REQUEST_EVENT, () => useFocusFloatStore.getState().request());
            offs.push(offAction, offOpen, offRequest);
            if (disposed) offs.forEach((off) => off());
        };
        setup().catch((error) => void logWarn('Floating timer: listen failed', { scope: 'focus', extra: { error: String(error) } }));
        return () => {
            disposed = true;
            offs.forEach((off) => off());
        };
    }, [supported]);
}
