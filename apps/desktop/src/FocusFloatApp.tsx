import { useCallback, useEffect, useRef, useState } from 'react';
import { adjustPomodoroPhase, canAdjustPomodoroPhase, POMODORO_ADJUST_STEP_MINUTES, translateWithFallback } from '@stride/core';
import { FocusFloatView } from './components/focus-float/FocusFloatView';
import './components/focus-float/focus-float.css';
import { useLanguage } from './contexts/language-context';
import { useMenuBarPanelTheme } from './hooks/useMenuBarPanelTheme';
import {
    FOCUS_FLOAT_SHOWN_EVENT,
    FOCUS_FLOAT_STATE_EVENT,
    deriveFocusFloatDisplay,
    deriveFocusFloatTimer,
    hideFocusFloat,
    openMainFromFocusFloat,
    sendFocusFloatAction,
    setFocusFloatExpanded,
    type FocusFloatAction,
    type FocusFloatState,
} from './lib/focus-float-window';
import { reportError } from './lib/report-error';
import { isTauriRuntime } from './lib/runtime';

const send = (action: FocusFloatAction) => {
    if (!isTauriRuntime()) return;
    void sendFocusFloatAction(action).catch((error) => reportError('Floating timer: action not delivered', error));
};

/** Re-render on each whole second of the countdown (measured from the state's timestamp). */
function useSecondClock(state: FocusFloatState | null): number {
    const [nowMs, setNowMs] = useState(() => Date.now());
    const running = state?.timer.isRunning === true;
    const anchor = state?.updatedAtMs ?? 0;
    useEffect(() => {
        setNowMs(Date.now());
        if (!running) return;
        let timer: number;
        const schedule = () => {
            const elapsed = Date.now() - anchor;
            const delay = 1000 - (((elapsed % 1000) + 1000) % 1000) + 8;
            timer = window.setTimeout(() => { setNowMs(Date.now()); schedule(); }, delay);
        };
        schedule();
        return () => window.clearTimeout(timer);
    }, [running, anchor]);
    return nowMs;
}

/**
 * Root of the floating timer window. A pure view of the state the main window sends; its buttons
 * go back to the main window (which owns the timer) or to Rust (window placement, open Stride).
 */
export function FocusFloatApp() {
    useMenuBarPanelTheme();
    const { t } = useLanguage();
    const tr = useCallback((key: string, fallback: string) => translateWithFallback(t, key, fallback), [t]);
    const [state, setState] = useState<FocusFloatState | null>(null);
    const [expanded, setExpanded] = useState(false);
    const nowMs = useSecondClock(state);

    useEffect(() => {
        if (!isTauriRuntime()) return;
        let disposed = false;
        const offs: Array<() => void> = [];
        void import('@tauri-apps/api/event').then(async ({ listen }) => {
            const offState = await listen<FocusFloatState>(FOCUS_FLOAT_STATE_EVENT, (event) => {
                if (event.payload?.timer) setState(event.payload);
            });
            const offShown = await listen(FOCUS_FLOAT_SHOWN_EVENT, () => send('sync'));
            offs.push(offState, offShown);
            if (disposed) offs.forEach((off) => off());
            else send('sync');
        }).catch((error) => reportError('Floating timer: listen failed', error));
        return () => {
            disposed = true;
            offs.forEach((off) => off());
        };
    }, []);

    const display = state ? deriveFocusFloatDisplay(state, nowMs) : null;

    // A phase ended here first (the main window may be throttled while hidden): ask it to catch up,
    // which also plays the usual completion alert. Once per boundary.
    const crossedKey = display?.crossed && state ? `${state.updatedAtMs}:${display.crossed}` : null;
    const lastCrossed = useRef<string | null>(null);
    useEffect(() => {
        if (!crossedKey || crossedKey === lastCrossed.current) return;
        lastCrossed.current = crossedKey;
        send('tick');
    }, [crossedKey]);

    // Finished or ready has nothing to expand: fold back to the compact size.
    const isDone = display?.view === 'finish' || display?.view === 'ready';
    useEffect(() => {
        if (!isDone || !expanded) return;
        setExpanded(false);
        if (isTauriRuntime()) void setFocusFloatExpanded(false).catch((error) => reportError('Floating timer: resize failed', error));
    }, [isDone, expanded]);

    if (!state || !display) return <div className="ff-root" aria-hidden />;

    const toggleRun = () => {
        // Optimistic: the main window confirms with fresh state a moment later.
        const now = Date.now();
        const current = deriveFocusFloatDisplay(state, now);
        // In overtime Pause ends the session: wait for the main window's check-in state.
        if (current.overtimeSeconds !== undefined && current.isRunning) { send('toggle'); return; }
        setState({
            ...state,
            timer: { ...state.timer, phase: current.phase, remainingSeconds: current.remainingSeconds, isRunning: !current.isRunning },
            updatedAtMs: now,
        });
        send('toggle');
    };
    // "−" / "+": optimistic here, the main window (which owns the timer) applies the same change.
    const timerNow = deriveFocusFloatTimer(state, nowMs);
    const adjust = (deltaMinutes: number) => {
        const now = Date.now();
        const result = adjustPomodoroPhase(deriveFocusFloatTimer(state, now), state.durations, deltaMinutes);
        if (result.changedSeconds === 0) return 0;
        setState({ ...state, timer: result.state, updatedAtMs: now });
        send(deltaMinutes > 0 ? 'add-time' : 'remove-time');
        return result.changedSeconds;
    };
    const toggleExpanded = () => {
        const next = !expanded;
        setExpanded(next);
        if (isTauriRuntime()) void setFocusFloatExpanded(next).catch((error) => reportError('Floating timer: resize failed', error));
    };
    const open = () => {
        if (isTauriRuntime()) void openMainFromFocusFloat().catch((error) => reportError('Floating timer: open Stride failed', error));
    };
    const close = () => {
        send('close');
        if (isTauriRuntime()) void hideFocusFloat().catch((error) => reportError('Floating timer: hide failed', error));
    };
    const startDrag = () => {
        if (!isTauriRuntime()) return;
        void import('@tauri-apps/api/window')
            .then(({ getCurrentWindow }) => getCurrentWindow().startDragging())
            .catch((error) => reportError('Floating timer: drag failed', error));
    };

    return (
        <FocusFloatView
            state={state}
            display={display}
            expanded={expanded}
            tr={tr}
            onToggleRun={toggleRun}
            onOpen={open}
            onToggleExpanded={toggleExpanded}
            onClose={close}
            onStartNext={() => send('start-next')}
            onDragStart={startDrag}
            adjust={{
                canDecrease: canAdjustPomodoroPhase(timerNow, state.durations, -POMODORO_ADJUST_STEP_MINUTES),
                canIncrease: canAdjustPomodoroPhase(timerNow, state.durations, POMODORO_ADJUST_STEP_MINUTES),
                onAdjust: adjust,
            }}
        />
    );
}
