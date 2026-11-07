import {
    advancePomodoroState,
    getPomodoroOvertimeSeconds,
    getPomodoroPhaseTotalSeconds,
    isPomodoroInOvertime,
    type PomodoroAutoStartOptions,
    type PomodoroDurations,
    type PomodoroEvent,
    type PomodoroState,
} from '@stride/core';
import { invokeNative } from './tauri-invoke';

/**
 * The floating focus timer: a small native always-on-top window (label `focus-float`, see
 * src-tauri/src/floating_timer.rs) that keeps the Pomodoro visible over other apps.
 *
 * It is a remote view. The main window owns the timer (ticks, alerts, credits) and pushes a
 * `FocusFloatState` to the float whenever something other than the countdown changes; the float
 * derives the ticking time from that state's timestamp, so every window shows the same second
 * without its own clock drifting. Buttons in the float send `FocusFloatAction`s back.
 */
export const FOCUS_FLOAT_WINDOW_LABEL = 'focus-float';
export const FOCUS_FLOAT_WINDOW_PARAM = 'focusFloat';
export const FOCUS_FLOAT_MAIN_WINDOW_LABEL = 'main';
/** Main -> float: the latest state to show. */
export const FOCUS_FLOAT_STATE_EVENT = 'focus-float-state';
/** Float -> main: a button was pressed (or the float needs fresh state). */
export const FOCUS_FLOAT_ACTION_EVENT = 'focus-float-action';
/** Rust -> float: the window was just shown. */
export const FOCUS_FLOAT_SHOWN_EVENT = 'focus-float-shown';
/** Rust -> main: the float asked to open Stride on the full Focus stage. */
export const FOCUS_FLOAT_OPEN_EVENT = 'focus-float-open';
/** Menu bar panel -> main: "Float timer" was pressed there. */
export const FOCUS_FLOAT_REQUEST_EVENT = 'focus-float-request';

/** What the float shows: counting down, on a break, a finished session, or ready for the next one. */
export type FocusFloatView = 'focus' | 'break' | 'finish' | 'ready';

export type FocusFloatState = {
    timer: PomodoroState;
    durations: PomodoroDurations;
    /** When `timer` was true; the float advances it from here. */
    updatedAtMs: number;
    autoStart: PomodoroAutoStartOptions;
    view: FocusFloatView;
    taskTitle: string | null;
    currentStep: string | null;
    nextStep: string | null;
};

export type FocusFloatAction = 'toggle' | 'open' | 'close' | 'start-next' | 'sync' | 'tick' | 'add-time' | 'remove-time';

export type FocusFloatDisplay = {
    view: FocusFloatView;
    phase: PomodoroState['phase'];
    isRunning: boolean;
    remainingSeconds: number;
    totalSeconds: number;
    progress: number;
    /** Present while counting up past 0:00 ("Keep going"); `progress` is then the faint second lap. */
    overtimeSeconds?: number;
    /** A phase ended since `state` was sent (the float tells the main window to catch up). */
    crossed: PomodoroEvent | null;
};

export function isFocusFloatLocation(location: Pick<Location, 'search'> = window.location): boolean {
    const value = new URLSearchParams(location.search).get(FOCUS_FLOAT_WINDOW_PARAM);
    return value === '1' || value?.toLowerCase() === 'true';
}

function advanceFocusFloatTimer(state: FocusFloatState, nowMs: number) {
    const elapsed = Math.floor((nowMs - state.updatedAtMs) / 1000);
    return state.timer.isRunning && elapsed > 0
        ? advancePomodoroState(state.timer, state.durations, elapsed, state.autoStart)
        : { state: state.timer, lastEvent: null };
}

/** The raw timer state as of `nowMs` (for optimistic changes made in the float). */
export function deriveFocusFloatTimer(state: FocusFloatState, nowMs: number): PomodoroState {
    return advanceFocusFloatTimer(state, nowMs).state;
}

/** The timer as of `nowMs`, derived from the last state the main window sent. */
export function deriveFocusFloatDisplay(state: FocusFloatState, nowMs: number): FocusFloatDisplay {
    const advanced = advanceFocusFloatTimer(state, nowMs);
    const timer = advanced.state;
    const crossed = advanced.lastEvent;
    let view = state.view;
    if (crossed === 'focus-finished') view = 'finish';
    else if (crossed === 'break-finished') view = timer.isRunning ? 'focus' : 'ready';
    else if (view !== 'finish' && view !== 'ready') view = timer.phase === 'break' ? 'break' : 'focus';
    const totalSeconds = Math.max(1, getPomodoroPhaseTotalSeconds(timer, state.durations));
    const remainingSeconds = Math.max(0, timer.remainingSeconds);
    const overtime = view === 'focus' && isPomodoroInOvertime(timer);
    const overtimeSeconds = overtime ? getPomodoroOvertimeSeconds(timer) : undefined;
    return {
        view,
        phase: timer.phase,
        isRunning: timer.isRunning,
        remainingSeconds,
        totalSeconds,
        progress: overtime
            ? Math.min(1, (overtimeSeconds ?? 0) / totalSeconds)
            : Math.min(1, Math.max(0, 1 - remainingSeconds / totalSeconds)),
        ...(overtime ? { overtimeSeconds } : {}),
        // Reaching 0:00 into overtime is not a phase end: the main window chimes on its own tick.
        crossed: crossed === 'focus-overtime' ? null : crossed,
    };
}

/** True when two states differ in more than the countdown (so the float needs the new one). */
export function focusFloatStateChanged(prev: FocusFloatState | null, next: FocusFloatState): boolean {
    if (!prev) return true;
    return prev.view !== next.view
        || prev.timer.isRunning !== next.timer.isRunning
        || prev.timer.phase !== next.timer.phase
        || prev.timer.completedFocusSessions !== next.timer.completedFocusSessions
        || prev.timer.phaseTotalSeconds !== next.timer.phaseTotalSeconds
        || isPomodoroInOvertime(prev.timer) !== isPomodoroInOvertime(next.timer)
        || prev.timer.keepGoing !== next.timer.keepGoing
        || prev.durations.focusMinutes !== next.durations.focusMinutes
        || prev.durations.breakMinutes !== next.durations.breakMinutes
        || prev.autoStart.autoStartBreaks !== next.autoStart.autoStartBreaks
        || prev.autoStart.autoStartFocus !== next.autoStart.autoStartFocus
        || prev.taskTitle !== next.taskTitle
        || prev.currentStep !== next.currentStep
        || prev.nextStep !== next.nextStep
        // Paused, or the remaining time was edited: the countdown alone can't explain the change.
        || (!next.timer.isRunning && prev.timer.remainingSeconds !== next.timer.remainingSeconds)
        || Math.abs(
            (prev.timer.remainingSeconds - Math.floor((next.updatedAtMs - prev.updatedAtMs) / 1000))
            - next.timer.remainingSeconds,
        ) > 1;
}

export type FocusFloatVisibilityInput = {
    /** A native float window exists on this platform (Tauri desktop). */
    supported: boolean;
    /** A focus session is open and not idle (running, paused mid-phase, finished or ready). */
    live: boolean;
    presentation: 'full' | 'mini' | 'hidden';
    /** The main window is visible and has focus. */
    mainActive: boolean;
    /** Setting: show the float automatically while a session runs. */
    autoShow: boolean;
    /** The user asked for the float this session (Minimise, or a "Float timer" button). */
    requested: boolean;
    /** The user closed the float this session. */
    closedByUser: boolean;
};

/**
 * Whether the float should be on screen. Never while the full stage is in front of the user
 * (it already shows the timer); otherwise when asked for, or automatically when the setting is on.
 */
export function shouldShowFocusFloat(input: FocusFloatVisibilityInput): boolean {
    if (!input.supported || !input.live || input.closedByUser) return false;
    if (input.presentation === 'full' && input.mainActive) return false;
    return input.requested || input.autoShow;
}

export const showFocusFloat = (): Promise<void> => invokeNative<void>('focus_float_show');
export const hideFocusFloat = (): Promise<void> => invokeNative<void>('focus_float_hide');
export const setFocusFloatExpanded = (expanded: boolean): Promise<void> => (
    invokeNative<void>('focus_float_set_expanded', { expanded })
);
/** Shows the main window; Rust then tells it to bring the Focus stage back to full. */
export const openMainFromFocusFloat = (): Promise<void> => invokeNative<void>('focus_float_open_main');

export async function sendFocusFloatAction(action: FocusFloatAction): Promise<void> {
    const { emitTo } = await import('@tauri-apps/api/event');
    await emitTo(FOCUS_FLOAT_MAIN_WINDOW_LABEL, FOCUS_FLOAT_ACTION_EVENT, { action });
}

export async function sendFocusFloatState(state: FocusFloatState): Promise<void> {
    const { emitTo } = await import('@tauri-apps/api/event');
    await emitTo(FOCUS_FLOAT_WINDOW_LABEL, FOCUS_FLOAT_STATE_EVENT, state);
}
