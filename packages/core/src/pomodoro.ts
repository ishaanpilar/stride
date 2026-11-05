import { isTaskActionable } from './task-status';
import type { Task } from './types';

export type PomodoroPhase = 'focus' | 'break';
/**
 * 'focus-overtime': a focus phase reached 0:00 and, instead of ending, keeps counting up ("Keep
 * going"). Only happens when the state allows it (`keepGoing`); the session is not finished yet.
 */
export type PomodoroEvent = 'focus-finished' | 'break-finished' | 'focus-overtime';

export interface PomodoroDurations {
    focusMinutes: number;
    breakMinutes: number;
}

export interface PomodoroAutoStartOptions {
    autoStartFocus?: boolean;
    autoStartBreaks?: boolean;
}

export interface PomodoroState {
    phase: PomodoroPhase;
    remainingSeconds: number;
    isRunning: boolean;
    completedFocusSessions: number;
    /**
     * Length of the current phase in seconds when it differs from the configured duration (time was
     * added with "+5" / "+10", or a finished focus was resumed). Absent = the configured duration.
     * Dropped automatically when the phase changes.
     */
    phaseTotalSeconds?: number;
    /** Seconds added to the current phase so far (capped by POMODORO_MAX_EXTENSION_MINUTES). */
    extendedSeconds?: number;
    /**
     * "Keep going": when this focus phase reaches 0:00 it counts up as overtime instead of ending.
     * The host sets it (setting on, a task linked and still open); absent = end at 0:00 as before.
     */
    keepGoing?: boolean;
    /** Present while in overtime: seconds counted up past 0:00 (remainingSeconds stays 0). */
    overtimeSeconds?: number;
    /** On the phase after a focus ended: how long that focus really was (configured, added, overtime). */
    lastFocusSeconds?: number;
}

export interface PomodoroSessionHistory {
    totalCompletedFocusSessions: number;
    completedFocusSessionsByTaskId: Record<string, number>;

    todayDayKey: string;

    completedTodayFocusSessions: number;
}

export interface PomodoroTickResult {
    state: PomodoroState;
    switchedPhase: boolean;
    completedFocusSession: boolean;
    /** Set when the tick produced an event other than a plain phase switch (overtime start / cap). */
    event?: PomodoroEvent | null;
}

export interface PomodoroAdvanceResult {
    state: PomodoroState;
    lastEvent: PomodoroEvent | null;
}

export interface PomodoroPreset extends PomodoroDurations {
    id: 'quick' | 'classic' | 'deep' | 'custom';
    label: string;
}

export const DEFAULT_POMODORO_DURATIONS: PomodoroDurations = {
    focusMinutes: 25,
    breakMinutes: 5,
};

export const POMODORO_PRESETS: readonly PomodoroPreset[] = [
    { id: 'quick', label: '15/3', focusMinutes: 15, breakMinutes: 3 },
    { id: 'classic', label: '25/5', focusMinutes: 25, breakMinutes: 5 },
    { id: 'deep', label: '50/10', focusMinutes: 50, breakMinutes: 10 },
] as const;

const MIN_MINUTES = 1;
const MAX_MINUTES = 180;

function clampMinutes(value: unknown, fallback: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    const rounded = Math.round(value);
    if (rounded < MIN_MINUTES) return MIN_MINUTES;
    if (rounded > MAX_MINUTES) return MAX_MINUTES;
    return rounded;
}

export function sanitizePomodoroDurations(value?: Partial<PomodoroDurations>): PomodoroDurations {
    return {
        focusMinutes: clampMinutes(value?.focusMinutes, DEFAULT_POMODORO_DURATIONS.focusMinutes),
        breakMinutes: clampMinutes(value?.breakMinutes, DEFAULT_POMODORO_DURATIONS.breakMinutes),
    };
}

export function createPomodoroCustomPreset(value?: Partial<PomodoroDurations>): PomodoroPreset | null {
    if (!value || (value.focusMinutes === undefined && value.breakMinutes === undefined)) {
        return null;
    }

    const durations = sanitizePomodoroDurations(value);
    const matchesBuiltInPreset = POMODORO_PRESETS.some(
        (preset) => preset.focusMinutes === durations.focusMinutes && preset.breakMinutes === durations.breakMinutes
    );

    if (matchesBuiltInPreset) return null;

    return {
        id: 'custom',
        label: `${durations.focusMinutes}/${durations.breakMinutes}`,
        ...durations,
    };
}

export function getPomodoroPresetOptions(customDurations?: Partial<PomodoroDurations>): readonly PomodoroPreset[] {
    const customPreset = createPomodoroCustomPreset(customDurations);
    return customPreset ? [...POMODORO_PRESETS, customPreset] : POMODORO_PRESETS;
}

export function getPomodoroPhaseSeconds(phase: PomodoroPhase, durations: PomodoroDurations = DEFAULT_POMODORO_DURATIONS): number {
    const normalized = sanitizePomodoroDurations(durations);
    const minutes = phase === 'focus' ? normalized.focusMinutes : normalized.breakMinutes;
    return minutes * 60;
}

/** Most time that can be added to one phase, in total. */
export const POMODORO_MAX_EXTENSION_MINUTES = 120;
/** Bounds of a single "+…" custom amount. */
export const POMODORO_EXTEND_MIN_MINUTES = 1;
export const POMODORO_EXTEND_MAX_MINUTES = 60;
/** The quick amounts offered on every running-timer surface. */
export const POMODORO_EXTEND_QUICK_MINUTES = [5, 10] as const;

/** Total length of the current phase (configured duration plus any added time). */
export function getPomodoroPhaseTotalSeconds(state: Pick<PomodoroState, 'phase' | 'phaseTotalSeconds'>, durations: PomodoroDurations = DEFAULT_POMODORO_DURATIONS): number {
    const total = state.phaseTotalSeconds;
    if (typeof total === 'number' && Number.isFinite(total) && total > 0) return Math.floor(total);
    return getPomodoroPhaseSeconds(state.phase, durations);
}

/** Seconds that can still be added to the current phase before the cap. */
export function getPomodoroExtensionRoomSeconds(state: Pick<PomodoroState, 'extendedSeconds'>): number {
    const used = typeof state.extendedSeconds === 'number' && Number.isFinite(state.extendedSeconds) ? Math.max(0, state.extendedSeconds) : 0;
    return Math.max(0, POMODORO_MAX_EXTENSION_MINUTES * 60 - used);
}

/** A whole number of minutes in 1–60, or null when the input is not a usable amount. */
export function normalizePomodoroExtendMinutes(value: unknown): number | null {
    const numeric = typeof value === 'string' ? Number(value.trim()) : value;
    if (typeof numeric !== 'number' || !Number.isFinite(numeric)) return null;
    const rounded = Math.round(numeric);
    if (rounded < POMODORO_EXTEND_MIN_MINUTES || rounded > POMODORO_EXTEND_MAX_MINUTES) return null;
    return rounded;
}

export interface PomodoroExtendResult {
    state: PomodoroState;
    /** Seconds actually added (less than asked when the cap is reached; 0 = nothing changed). */
    addedSeconds: number;
}

/**
 * Add time to the CURRENT phase without resetting it: the remaining time and the phase total (for
 * the progress ring) both grow, running or paused stays as it was. Capped per phase.
 */
export function extendPomodoroPhase(
    state: PomodoroState,
    durations: PomodoroDurations = DEFAULT_POMODORO_DURATIONS,
    minutes: number,
): PomodoroExtendResult {
    const amount = normalizePomodoroExtendMinutes(minutes);
    if (amount === null) return { state, addedSeconds: 0 };
    const addedSeconds = Math.min(amount * 60, getPomodoroExtensionRoomSeconds(state));
    if (addedSeconds <= 0) return { state, addedSeconds: 0 };
    if (isPomodoroInOvertime(state)) {
        // Back from overtime into a countdown: the time already worked stays in the phase length.
        const { overtimeSeconds: worked = 0, ...rest } = state;
        return {
            state: {
                ...rest,
                remainingSeconds: addedSeconds,
                phaseTotalSeconds: getPomodoroPhaseTotalSeconds(state, durations) + worked + addedSeconds,
                extendedSeconds: (state.extendedSeconds ?? 0) + addedSeconds,
            },
            addedSeconds,
        };
    }
    return {
        state: {
            ...state,
            remainingSeconds: Math.max(0, state.remainingSeconds) + addedSeconds,
            phaseTotalSeconds: getPomodoroPhaseTotalSeconds(state, durations) + addedSeconds,
            extendedSeconds: (state.extendedSeconds ?? 0) + addedSeconds,
        },
        addedSeconds,
    };
}

/**
 * "Need more time?" after a focus check-in: keep working on the same task for a few more minutes.
 * Mid-focus (the task's steps were all ticked) it extends the running phase; after a finished focus
 * session (now on a break or ready) it reopens a short focus phase of exactly that length. Runs.
 */
export function resumePomodoroFocus(
    state: PomodoroState,
    durations: PomodoroDurations = DEFAULT_POMODORO_DURATIONS,
    minutes: number,
): PomodoroExtendResult {
    const amount = normalizePomodoroExtendMinutes(minutes);
    if (amount === null) return { state, addedSeconds: 0 };
    if (state.phase === 'focus' && state.remainingSeconds > 0) {
        const extended = extendPomodoroPhase(state, durations, amount);
        return { state: { ...extended.state, isRunning: true }, addedSeconds: extended.addedSeconds };
    }
    const seconds = amount * 60;
    return {
        state: {
            phase: 'focus',
            remainingSeconds: seconds,
            isRunning: true,
            completedFocusSessions: state.completedFocusSessions,
            phaseTotalSeconds: seconds,
            extendedSeconds: seconds,
        },
        addedSeconds: seconds,
    };
}

/** Whole minutes of focus a finished phase is worth (configured length, added time and overtime). */
export function getPomodoroFocusCreditMinutes(state: Pick<PomodoroState, 'phase' | 'phaseTotalSeconds' | 'overtimeSeconds'>, durations: PomodoroDurations = DEFAULT_POMODORO_DURATIONS): number {
    if (state.phase !== 'focus') return sanitizePomodoroDurations(durations).focusMinutes;
    return Math.max(1, Math.round((getPomodoroPhaseTotalSeconds(state, durations) + getPomodoroOvertimeSeconds(state)) / 60));
}

/** Overtime ("Keep going") ends on its own after this long, with the check-in. */
export const POMODORO_OVERTIME_CAP_MINUTES = 60;

/** True while a focus phase is counting up past 0:00. */
export function isPomodoroInOvertime(state: Pick<PomodoroState, 'phase' | 'overtimeSeconds'>): boolean {
    return state.phase === 'focus' && typeof state.overtimeSeconds === 'number' && Number.isFinite(state.overtimeSeconds);
}

export function getPomodoroOvertimeSeconds(state: Pick<PomodoroState, 'phase' | 'overtimeSeconds'>): number {
    return isPomodoroInOvertime(state) ? Math.max(0, Math.floor(state.overtimeSeconds as number)) : 0;
}

/** "+M:SS" (or "+H:MM:SS") for the overtime counter. */
export function formatPomodoroOvertime(seconds: number): string {
    const safe = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    const secs = String(safe % 60).padStart(2, '0');
    return hours > 0 ? `+${hours}:${String(minutes).padStart(2, '0')}:${secs}` : `+${minutes}:${secs}`;
}

/** Second-lap progress for the ring while in overtime (0..1, one lap = the phase length). */
export function getPomodoroOvertimeProgress(state: PomodoroState, durations: PomodoroDurations = DEFAULT_POMODORO_DURATIONS): number {
    const total = getPomodoroPhaseTotalSeconds(state, durations);
    return total > 0 ? Math.min(1, getPomodoroOvertimeSeconds(state) / total) : 0;
}

/**
 * End a focus phase that is in overtime (task ticked done, paused/stopped, the cap, or a check-in
 * choice): the session counts as completed, with its overtime, and stops on the break.
 */
export function finishPomodoroOvertime(state: PomodoroState, durations: PomodoroDurations = DEFAULT_POMODORO_DURATIONS): PomodoroState {
    if (!isPomodoroInOvertime(state)) return state;
    return {
        phase: 'break',
        remainingSeconds: getPomodoroPhaseSeconds('break', durations),
        isRunning: false,
        completedFocusSessions: state.completedFocusSessions + 1,
        lastFocusSeconds: getPomodoroPhaseTotalSeconds(state, durations) + getPomodoroOvertimeSeconds(state),
    };
}

/**
 * Pause / resume. Pausing in overtime ends the session instead (the check-in follows), because
 * there is no time left to resume into. `finished` says which happened.
 */
export function togglePomodoroRunning(state: PomodoroState, durations: PomodoroDurations = DEFAULT_POMODORO_DURATIONS): { state: PomodoroState; finished: boolean } {
    if (state.isRunning && isPomodoroInOvertime(state)) return { state: finishPomodoroOvertime(state, durations), finished: true };
    return { state: { ...state, isRunning: !state.isRunning }, finished: false };
}

function sanitizeCompletedSessionCount(value: unknown, fallback = 0): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return Math.max(0, Math.floor(fallback));
    return Math.max(0, Math.floor(value));
}

export function getPomodoroLocalDayKey(nowMs = Date.now()): string {
    const date = new Date(nowMs);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function sanitizePomodoroSessionHistory(
    value?: Partial<PomodoroSessionHistory> | null,
    fallbackTotalCompletedFocusSessions = 0,
    todayDayKey: string = getPomodoroLocalDayKey()
): PomodoroSessionHistory {
    const completedFocusSessionsByTaskId: Record<string, number> = {};
    const rawByTaskId = value?.completedFocusSessionsByTaskId;

    if (rawByTaskId && typeof rawByTaskId === 'object' && !Array.isArray(rawByTaskId)) {
        for (const [rawTaskId, rawCount] of Object.entries(rawByTaskId)) {
            const taskId = rawTaskId.trim();
            if (!taskId) continue;
            const count = sanitizeCompletedSessionCount(rawCount);
            if (count <= 0) continue;
            completedFocusSessionsByTaskId[taskId] = count;
        }
    }

    const taskTotal = Object.values(completedFocusSessionsByTaskId)
        .reduce((sum, count) => sum + count, 0);
    const totalCompletedFocusSessions = Math.max(
        sanitizeCompletedSessionCount(value?.totalCompletedFocusSessions),
        sanitizeCompletedSessionCount(fallbackTotalCompletedFocusSessions),
        taskTotal
    );


    const completedTodayFocusSessions = value?.todayDayKey === todayDayKey
        ? sanitizeCompletedSessionCount(value?.completedTodayFocusSessions)
        : 0;

    return {
        totalCompletedFocusSessions,
        completedFocusSessionsByTaskId,
        todayDayKey,
        completedTodayFocusSessions,
    };
}


export function getPomodoroFocusSessionsCompletedToday(
    history: Partial<PomodoroSessionHistory> | undefined,
    todayDayKey: string = getPomodoroLocalDayKey()
): number {
    if (!history || history.todayDayKey !== todayDayKey) return 0;
    return sanitizeCompletedSessionCount(history.completedTodayFocusSessions);
}

export function recordPomodoroFocusSessions(
    history: Partial<PomodoroSessionHistory> | undefined,
    taskId?: string,
    completedSessions = 1,
    todayDayKey: string = getPomodoroLocalDayKey()
): PomodoroSessionHistory {
    const sanitized = sanitizePomodoroSessionHistory(history, 0, todayDayKey);
    const increment = sanitizeCompletedSessionCount(completedSessions);
    if (increment <= 0) return sanitized;

    const next: PomodoroSessionHistory = {
        totalCompletedFocusSessions: sanitized.totalCompletedFocusSessions + increment,
        completedFocusSessionsByTaskId: { ...sanitized.completedFocusSessionsByTaskId },
        todayDayKey: sanitized.todayDayKey,
        completedTodayFocusSessions: sanitized.completedTodayFocusSessions + increment,
    };
    const normalizedTaskId = taskId?.trim();
    if (normalizedTaskId) {
        next.completedFocusSessionsByTaskId[normalizedTaskId] = (
            next.completedFocusSessionsByTaskId[normalizedTaskId] ?? 0
        ) + increment;
    }

    return next;
}

export function createPomodoroState(
    durations: PomodoroDurations = DEFAULT_POMODORO_DURATIONS,
    phase: PomodoroPhase = 'focus',
    completedFocusSessions = 0
): PomodoroState {
    return {
        phase,
        remainingSeconds: getPomodoroPhaseSeconds(phase, durations),
        isRunning: false,
        completedFocusSessions: Math.max(0, Math.floor(completedFocusSessions)),
    };
}

export function resetPomodoroState(
    state: PomodoroState,
    durations: PomodoroDurations = DEFAULT_POMODORO_DURATIONS,
    phase: PomodoroPhase = state.phase
): PomodoroState {
    return {
        ...createPomodoroState(durations, phase, state.completedFocusSessions),
    };
}

export function tickPomodoroState(
    state: PomodoroState,
    durations: PomodoroDurations = DEFAULT_POMODORO_DURATIONS,
    options: PomodoroAutoStartOptions = {},
): PomodoroTickResult {
    if (!state.isRunning) {
        return {
            state,
            switchedPhase: false,
            completedFocusSession: false,
        };
    }

    if (isPomodoroInOvertime(state)) {
        const overtimeSeconds = getPomodoroOvertimeSeconds(state) + 1;
        if (overtimeSeconds >= POMODORO_OVERTIME_CAP_MINUTES * 60) {
            return {
                state: finishPomodoroOvertime({ ...state, overtimeSeconds }, durations),
                switchedPhase: true,
                completedFocusSession: true,
                event: 'focus-finished',
            };
        }
        return { state: { ...state, remainingSeconds: 0, overtimeSeconds }, switchedPhase: false, completedFocusSession: false, event: null };
    }

    if (state.remainingSeconds > 1) {
        return {
            state: {
                ...state,
                remainingSeconds: state.remainingSeconds - 1,
            },
            switchedPhase: false,
            completedFocusSession: false,
        };
    }

    if (state.phase === 'focus' && state.keepGoing === true) {
        // "Keep going": 0:00 is reached, the task is not done yet. Count up instead of ending.
        return {
            state: { ...state, remainingSeconds: 0, overtimeSeconds: 0 },
            switchedPhase: false,
            completedFocusSession: false,
            event: 'focus-overtime',
        };
    }

    if (state.phase === 'focus') {
        return {
            state: {
                phase: 'break',
                remainingSeconds: getPomodoroPhaseSeconds('break', durations),
                isRunning: options.autoStartBreaks === true,
                completedFocusSessions: state.completedFocusSessions + 1,
            },
            switchedPhase: true,
            completedFocusSession: true,
        };
    }

    return {
        state: {
            phase: 'focus',
            remainingSeconds: getPomodoroPhaseSeconds('focus', durations),
            isRunning: options.autoStartFocus === true,
            completedFocusSessions: state.completedFocusSessions,
        },
        switchedPhase: true,
        completedFocusSession: false,
    };
}

export function advancePomodoroState(
    state: PomodoroState,
    durations: PomodoroDurations = DEFAULT_POMODORO_DURATIONS,
    elapsedSeconds: number,
    options: PomodoroAutoStartOptions = {},
): PomodoroAdvanceResult {
    const safeElapsedSeconds = Math.max(0, Math.floor(elapsedSeconds));
    if (!Number.isFinite(elapsedSeconds) || safeElapsedSeconds <= 0 || !state.isRunning) {
        return {
            state,
            lastEvent: null,
        };
    }

    let nextState = state;
    let lastEvent: PomodoroEvent | null = null;
    let remainingElapsedSeconds = safeElapsedSeconds;

    while (remainingElapsedSeconds > 0 && nextState.isRunning) {
        if (isPomodoroInOvertime(nextState)) {
            // Count up; stop at the cap (the session finishes and the check-in follows).
            const room = POMODORO_OVERTIME_CAP_MINUTES * 60 - getPomodoroOvertimeSeconds(nextState);
            if (remainingElapsedSeconds < room) {
                nextState = { ...nextState, overtimeSeconds: getPomodoroOvertimeSeconds(nextState) + remainingElapsedSeconds };
                break;
            }
            nextState = finishPomodoroOvertime({ ...nextState, overtimeSeconds: POMODORO_OVERTIME_CAP_MINUTES * 60 }, durations);
            remainingElapsedSeconds -= room;
            lastEvent = 'focus-finished';
            break;
        }

        const countdownSeconds = nextState.remainingSeconds > 1
            ? Math.ceil(nextState.remainingSeconds) - 1
            : 0;
        if (remainingElapsedSeconds <= countdownSeconds) {
            nextState = { ...nextState, remainingSeconds: nextState.remainingSeconds - remainingElapsedSeconds };
            break;
        }

        const next = tickPomodoroState({
            ...nextState,
            remainingSeconds: nextState.remainingSeconds - countdownSeconds,
        }, durations, options);
        nextState = next.state;
        remainingElapsedSeconds -= countdownSeconds + 1;
        lastEvent = next.event ?? (next.completedFocusSession ? 'focus-finished' : 'break-finished');
        if (next.event === 'focus-overtime') continue;

        if (nextState.isRunning && options.autoStartFocus === true && options.autoStartBreaks === true) {


            const cycleSeconds = getPomodoroPhaseSeconds('focus', durations) + getPomodoroPhaseSeconds('break', durations);
            const fullCycles = Math.floor(remainingElapsedSeconds / cycleSeconds);
            if (fullCycles > 0) {
                const count = nextState.completedFocusSessions;
                const incremented = count + 1;


                const completedFocusSessions = incremented === count
                    ? count
                    : count >= Number.MAX_SAFE_INTEGER + 1
                        ? incremented
                        : Math.min(count + fullCycles, Number.MAX_SAFE_INTEGER + 1);
                nextState = { ...nextState, completedFocusSessions };
                remainingElapsedSeconds %= cycleSeconds;
                lastEvent = nextState.phase === 'focus' ? 'break-finished' : 'focus-finished';
            }
        }
    }

    return {
        state: nextState,
        lastEvent,
    };
}

export function formatPomodoroClock(totalSeconds: number): string {
    const safeSeconds = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    const seconds = safeSeconds % 60;

    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    const totalMinutes = Math.floor(safeSeconds / 60);
    return `${String(totalMinutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function getPomodoroTaskChoices(pools: {
    focusedTasks: readonly Task[]; schedule: readonly Task[]; nextActions: readonly Task[]; reviewDue: readonly Task[];
}): Task[] {
    const byId = new Map<string, Task>();
    for (const task of [...pools.focusedTasks, ...pools.schedule, ...pools.nextActions, ...pools.reviewDue]) {

        if (!task.deletedAt && isTaskActionable(task)) byId.set(task.id, task);
    }
    return Array.from(byId.values());
}
