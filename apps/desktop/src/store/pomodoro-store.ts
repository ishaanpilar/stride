import { createWithEqualityFn } from 'zustand/traditional';
import { armPomodoroCompletionSound } from '../lib/pomodoro-alert';
import {
    addTimeSpentMinutes,
    advancePomodoroState,
    createPomodoroState,
    DEFAULT_POMODORO_DURATIONS,
    extendPomodoroPhase,
    finishPomodoroOvertime,
    flushPendingSave,
    getPomodoroFocusCreditMinutes,
    getPomodoroPhaseSeconds,
    isPomodoroInOvertime,
    isTaskActionable,
    POMODORO_MAX_EXTENSION_MINUTES,
    POMODORO_OVERTIME_CAP_MINUTES,
    logInfo,
    logWarn,
    recordPomodoroFocusSessions,
    resetPomodoroState,
    resumePomodoroFocus as resumeFocusState,
    runStoreCommand,
    sanitizePomodoroDurations,
    sanitizePomodoroSessionHistory,
    useTaskStore,
    type PomodoroAutoStartOptions,
    type PomodoroDurations,
    type PomodoroEvent,
    type PomodoroSessionHistory,
    type PomodoroState,
} from '@stride/core';
import { getWorkspaceCache } from '../lib/workspace-cache';
import { readPomodoroKeepGoing } from '../lib/pomodoro-preferences';

export const DESKTOP_POMODORO_SESSION_STORAGE_KEY = 'stride:pomodoro:session:v1';
export const DESKTOP_POMODORO_COLLAPSED_STORAGE_KEY = 'stride:pomodoro:collapsed:v1';


type PomodoroCredit = { taskId: string; from?: number; to: number };

export type PomodoroSnapshot = {
    durations: PomodoroDurations;
    timerState: PomodoroState;
    selectedTaskId?: string;
    lastEvent: PomodoroEvent | null;
    updatedAtMs: number;
    sessionHistory: PomodoroSessionHistory;

    pendingCredits?: PomodoroCredit[];
};


const loadedCredits = new WeakSet<PomodoroCredit>();

const writtenCredits = new WeakSet<PomodoroCredit>();

const readCredits = (value: unknown): PomodoroCredit[] => (Array.isArray(value) ? value : []).flatMap((item) => {
    if (!isRecord(item) || typeof item.taskId !== 'string' || typeof item.to !== 'number' || !Number.isFinite(item.to)) return [];
    const credit: PomodoroCredit = { taskId: item.taskId, to: item.to,
        ...(typeof item.from === 'number' && Number.isFinite(item.from) ? { from: item.from } : {}) };
    loadedCredits.add(credit);
    return [credit];
});

const isRecord = (value: unknown): value is Record<string, unknown> => (
    !!value && typeof value === 'object' && !Array.isArray(value)
);

const createInitialSnapshot = (nowMs = Date.now()): PomodoroSnapshot => ({
    durations: DEFAULT_POMODORO_DURATIONS,
    timerState: createPomodoroState(DEFAULT_POMODORO_DURATIONS),
    selectedTaskId: undefined,
    lastEvent: null,
    updatedAtMs: nowMs,
    sessionHistory: sanitizePomodoroSessionHistory(),
});

export const reconcilePomodoroSnapshot = (
    snapshot: PomodoroSnapshot,
    nowMs: number,
    autoStartOptions: PomodoroAutoStartOptions
): PomodoroSnapshot => {
    if (!snapshot.timerState.isRunning) {
        return { ...snapshot, updatedAtMs: nowMs };
    }
    const elapsedSeconds = Math.floor((nowMs - snapshot.updatedAtMs) / 1000);
    if (elapsedSeconds <= 0) return snapshot;
    const advanced = advancePomodoroState(snapshot.timerState, snapshot.durations, elapsedSeconds, autoStartOptions);
    const completedSessionDelta = advanced.state.completedFocusSessions - snapshot.timerState.completedFocusSessions;
    const sessionHistory = completedSessionDelta > 0
        ? recordPomodoroFocusSessions(snapshot.sessionHistory, snapshot.selectedTaskId, completedSessionDelta)
        : snapshot.sessionHistory;
    const updatedAtMs = snapshot.updatedAtMs + elapsedSeconds * 1000;
    return {
        ...snapshot,
        timerState: {
            ...advanced.state,
            completedFocusSessions: Math.max(
                advanced.state.completedFocusSessions,
                sessionHistory.totalCompletedFocusSessions
            ),
        },
        sessionHistory,
        lastEvent: advanced.lastEvent ?? snapshot.lastEvent,
        updatedAtMs,
    };
};

const sanitizeStoredPomodoroState = (
    value: unknown,
    durations: PomodoroDurations
): PomodoroState => {
    const record = isRecord(value) ? value : {};
    const phase = record.phase === 'break' ? 'break' : 'focus';
    const baseState = createPomodoroState(
        durations,
        phase,
        typeof record.completedFocusSessions === 'number' ? record.completedFocusSessions : 0
    );
    // Time added with "+5"/"+10" (or a resumed focus) changes this phase's length; keep it, bounded.
    const configured = getPomodoroPhaseSeconds(phase, durations);
    const maxExtension = POMODORO_MAX_EXTENSION_MINUTES * 60;
    const extendedSeconds = typeof record.extendedSeconds === 'number' && Number.isFinite(record.extendedSeconds)
        ? Math.max(0, Math.min(maxExtension, Math.floor(record.extendedSeconds)))
        : 0;
    const phaseTotalSeconds = extendedSeconds > 0 && typeof record.phaseTotalSeconds === 'number' && Number.isFinite(record.phaseTotalSeconds)
        ? Math.max(1, Math.min(configured + extendedSeconds, Math.floor(record.phaseTotalSeconds)))
        : undefined;
    const limit = phaseTotalSeconds ?? baseState.remainingSeconds;
    const remainingSeconds = typeof record.remainingSeconds === 'number' && Number.isFinite(record.remainingSeconds)
        ? Math.max(0, Math.min(limit, Math.floor(record.remainingSeconds)))
        : limit;

    const keepGoing = phase === 'focus' && record.keepGoing === true;
    const overtimeSeconds = phase === 'focus' && typeof record.overtimeSeconds === 'number' && Number.isFinite(record.overtimeSeconds)
        ? Math.max(0, Math.min(POMODORO_OVERTIME_CAP_MINUTES * 60, Math.floor(record.overtimeSeconds)))
        : undefined;
    const lastFocusSeconds = phase === 'break' && typeof record.lastFocusSeconds === 'number' && Number.isFinite(record.lastFocusSeconds) && record.lastFocusSeconds > 0
        ? Math.floor(record.lastFocusSeconds)
        : undefined;

    return {
        ...baseState,
        remainingSeconds: overtimeSeconds !== undefined ? 0 : remainingSeconds,
        isRunning: record.isRunning === true,
        ...(phaseTotalSeconds !== undefined ? { phaseTotalSeconds, extendedSeconds } : {}),
        ...(keepGoing ? { keepGoing } : {}),
        ...(overtimeSeconds !== undefined ? { overtimeSeconds } : {}),
        ...(lastFocusSeconds !== undefined ? { lastFocusSeconds } : {}),
    };
};

const parseStoredPomodoroSnapshot = (value: unknown, nowMs: number): PomodoroSnapshot => {
    if (!isRecord(value)) return createInitialSnapshot(nowMs);

    const durations = sanitizePomodoroDurations(isRecord(value.durations) ? value.durations : undefined);
    const sanitizedTimerState = sanitizeStoredPomodoroState(value.timerState, durations);
    const sessionHistory = sanitizePomodoroSessionHistory(
        isRecord(value.sessionHistory) ? value.sessionHistory : undefined,
        sanitizedTimerState.completedFocusSessions
    );
    const timerState = {
        ...sanitizedTimerState,
        completedFocusSessions: Math.max(
            sanitizedTimerState.completedFocusSessions,
            sessionHistory.totalCompletedFocusSessions
        ),
    };
    const updatedAtMs = typeof value.updatedAtMs === 'number' && Number.isFinite(value.updatedAtMs)
        ? value.updatedAtMs
        : nowMs;
    const selectedTaskId = typeof value.selectedTaskId === 'string' && value.selectedTaskId.trim().length > 0
        ? value.selectedTaskId
        : undefined;
    const pendingCredits = readCredits(value.pendingCredits);

    return {
        durations,
        timerState,
        selectedTaskId,
        lastEvent: null,
        updatedAtMs,
        sessionHistory,
        ...(pendingCredits.length > 0 ? { pendingCredits } : {}),
    };
};

const readStoredPomodoroSnapshot = (nowMs: number): PomodoroSnapshot => {
    if (typeof window === 'undefined') return createInitialSnapshot(nowMs);
    try {
        const raw = getWorkspaceCache()?.getItem(DESKTOP_POMODORO_SESSION_STORAGE_KEY);
        if (!raw) return createInitialSnapshot(nowMs);
        return parseStoredPomodoroSnapshot(JSON.parse(raw) as unknown, nowMs);
    } catch {
        return createInitialSnapshot(nowMs);
    }
};


const saveStoredPomodoroSnapshot = (snapshot: PomodoroSnapshot): boolean => {
    if (typeof window === 'undefined') return false;
    try {
        const cache = getWorkspaceCache();
        if (!cache) return false;
        cache.setItem(DESKTOP_POMODORO_SESSION_STORAGE_KEY, JSON.stringify({
            durations: snapshot.durations,
            timerState: snapshot.timerState,
            selectedTaskId: snapshot.selectedTaskId,
            updatedAtMs: snapshot.updatedAtMs,
            sessionHistory: snapshot.sessionHistory,
            ...(snapshot.pendingCredits?.length ? { pendingCredits: snapshot.pendingCredits } : {}),
        }));
        return true;
    } catch {

        return false;
    }
};


const isCountdownTickOnly = (prev: PomodoroSnapshot, next: PomodoroSnapshot): boolean => (
    prev.timerState.isRunning
    && next.timerState.isRunning
    && prev.timerState.phase === next.timerState.phase
    && prev.timerState.completedFocusSessions === next.timerState.completedFocusSessions
    // Added time changes the phase length: that must be saved for the other windows.
    && prev.timerState.phaseTotalSeconds === next.timerState.phaseTotalSeconds
    // So does going into overtime, or the rule that allows it.
    && prev.timerState.keepGoing === next.timerState.keepGoing
    && isPomodoroInOvertime(prev.timerState) === isPomodoroInOvertime(next.timerState)
    && prev.durations === next.durations
    && prev.selectedTaskId === next.selectedTaskId
    && prev.sessionHistory === next.sessionHistory
);

const readStoredCollapsed = (): boolean => {
    if (typeof window === 'undefined') return false;
    try {
        return getWorkspaceCache()?.getItem(DESKTOP_POMODORO_COLLAPSED_STORAGE_KEY) === 'true';
    } catch {
        return false;
    }
};

const saveStoredCollapsed = (collapsed: boolean) => {
    if (typeof window === 'undefined') return;
    try {
        getWorkspaceCache()?.setItem(DESKTOP_POMODORO_COLLAPSED_STORAGE_KEY, collapsed ? 'true' : 'false');
    } catch {

    }
};


/** The linked task can still be worked on (not done, archived, deleted or gone). */
const isSelectedTaskOpen = (taskId: string | undefined): boolean => {
    if (!taskId) return false;
    const task = useTaskStore.getState()._allTasks.find((candidate) => candidate.id === taskId);
    return Boolean(task && !task.deletedAt && isTaskActionable(task));
};

/**
 * End an overtime focus phase: the session counts (with its overtime) and the check-in follows
 * (lastEvent 'focus-finished'). Used for Pause/Stop in overtime and when the task is ticked done.
 */
export const finishPomodoroOvertimeSnapshot = (snapshot: PomodoroSnapshot, nowMs = Date.now()): PomodoroSnapshot => {
    if (!isPomodoroInOvertime(snapshot.timerState)) return snapshot;
    const finished = finishPomodoroOvertime(snapshot.timerState, snapshot.durations);
    const sessionHistory = recordPomodoroFocusSessions(snapshot.sessionHistory, snapshot.selectedTaskId, 1);
    return {
        ...snapshot,
        timerState: { ...finished, completedFocusSessions: Math.max(finished.completedFocusSessions, sessionHistory.totalCompletedFocusSessions) },
        sessionHistory,
        lastEvent: 'focus-finished',
        updatedAtMs: nowMs,
    };
};

/** Pause / resume from any surface. Pausing in overtime ends the session (the check-in follows). */
export const togglePomodoroSnapshot = (prev: PomodoroSnapshot, nowMs: number, autoStartOptions: PomodoroAutoStartOptions): PomodoroSnapshot => {
    const reconciled = reconcilePomodoroSnapshot(prev, nowMs, autoStartOptions);
    if (reconciled.timerState.isRunning && isPomodoroInOvertime(reconciled.timerState)) {
        quietFinishPending = true;
        return finishPomodoroOvertimeSnapshot(reconciled, nowMs);
    }
    return { ...reconciled, timerState: { ...reconciled.timerState, isRunning: !reconciled.timerState.isRunning }, updatedAtMs: nowMs };
};

/** A finish the user caused (Pause in overtime, task ticked done): no chime or notification for it. */
let quietFinishPending = false;

/**
 * "Keep going" rule, applied on every commit: a focus phase may run into overtime only while the
 * setting is on and its linked task is open. Overtime whose task was ticked done (anywhere) ends.
 */
const applyKeepGoing = (snapshot: PomodoroSnapshot): PomodoroSnapshot => {
    const timer = snapshot.timerState;
    if (timer.phase !== 'focus') return timer.keepGoing ? { ...snapshot, timerState: { ...timer, keepGoing: undefined } } : snapshot;
    const open = isSelectedTaskOpen(snapshot.selectedTaskId);
    if (isPomodoroInOvertime(timer) && !open) {
        quietFinishPending = true;
        return finishPomodoroOvertimeSnapshot(snapshot);
    }
    const allowed = open && readPomodoroKeepGoing();
    if ((timer.keepGoing === true) === allowed) return snapshot;
    const { keepGoing: _drop, ...rest } = timer;
    return { ...snapshot, timerState: allowed ? { ...rest, keepGoing: true } : rest };
};

const withNewCredits = (prev: PomodoroSnapshot, next: PomodoroSnapshot): PomodoroSnapshot => {
    const prevByTask = prev.sessionHistory.completedFocusSessionsByTaskId;
    const nextByTask = next.sessionHistory.completedFocusSessionsByTaskId;
    if (prevByTask === nextByTask) return next;
    const credits = [...(next.pendingCredits ?? [])];
    const { tasks } = useTaskStore.getState();
    for (const [taskId, count] of Object.entries(nextByTask)) {
        const delta = count - (prevByTask[taskId] ?? 0);
        const task = tasks.find((candidate) => candidate.id === taskId);
        if (delta <= 0 || !task) continue;

        const from = credits.filter((credit) => credit.taskId === taskId).pop()?.to ?? task.timeSpentMinutes;
        // The phase that just ended may have been longer (time added) or a short resumed focus.
        // A focus that ended from overtime records its real length on the next phase.
        const firstPhaseMinutes = next.timerState.lastFocusSeconds && prev.timerState.phase === 'focus'
            ? Math.max(1, Math.round(next.timerState.lastFocusSeconds / 60))
            : getPomodoroFocusCreditMinutes(prev.timerState, prev.durations);
        const to = addTimeSpentMinutes(from, firstPhaseMinutes + (delta - 1) * next.durations.focusMinutes);
        if (to !== undefined && to !== from) credits.push({ taskId, ...(from === undefined ? {} : { from }), to });
    }
    return credits.length === (next.pendingCredits?.length ?? 0) ? next : { ...next, pendingCredits: credits };
};


let settling: Promise<void> | null = null;

let settleGeneration = 0;
const settleCredits = (): Promise<void> => {
    const generation = settleGeneration;
    settling ??= (async () => {
        const credits = usePomodoroStore.getState().snapshot.pendingCredits ?? [];
        const done = new Set<PomodoroCredit>();
        for (const credit of credits) {

            const outcome = await runStoreCommand(async () => {
                const { tasks, updateTask } = useTaskStore.getState();
                const task = tasks.find((candidate) => candidate.id === credit.taskId);
                const time = task?.timeSpentMinutes;
                if (!task) return 'gone';

                if (time === credit.to && credit.to !== credit.from) return 'written';
                let to = credit.to;
                if (time !== credit.from) {
                    if (loadedCredits.has(credit) || writtenCredits.has(credit)) return 'gone';
                    let chainTo = credit.to;
                    to = addTimeSpentMinutes(time, credit.to - (credit.from ?? 0)) ?? credit.to;
                    credit.from = time;
                    credit.to = to;

                    const pending = usePomodoroStore.getState().snapshot.pendingCredits ?? [];
                    let movedTo = to;
                    for (const later of pending.slice(pending.indexOf(credit) + 1)) {
                        if (later.taskId !== credit.taskId || later.from !== chainTo || loadedCredits.has(later)) continue;
                        chainTo = later.to;
                        later.to = addTimeSpentMinutes(movedTo, later.to - later.from) ?? later.to;
                        later.from = movedTo;
                        movedTo = later.to;
                    }

                    if (!saveStoredPomodoroSnapshot(usePomodoroStore.getState().snapshot)) return null;
                    void logInfo('Pomodoro credit moved onto the task time', {
                        scope: 'pomodoro', context: { releaseCheck: 'v1.3.8/pomodoro-credit-moved', outcome: 'moved' },
                    });
                }
                await updateTask(credit.taskId, { timeSpentMinutes: to });
                writtenCredits.add(credit);
                return 'written';
            }).catch(() => null);
            if (!outcome) break;


            if (outcome === 'written' && !await flushPendingSave()
                .then(() => useTaskStore.getState().persistenceFailure === null, () => false)) {
                void logWarn('Pomodoro credit kept owed: the task save did not finish', {
                    scope: 'pomodoro', context: { releaseCheck: 'v1.3.8/pomodoro-credit-durable', outcome: 'owed' },
                });
                break;
            }
            done.add(credit);
        }
        if (done.size > 0) {
            const snapshot = usePomodoroStore.getState().snapshot;
            const left = (snapshot.pendingCredits ?? []).filter((credit) => !done.has(credit));
            const next = { ...snapshot, pendingCredits: left.length > 0 ? left : undefined };
            saveStoredPomodoroSnapshot(next);
            usePomodoroStore.setState({ snapshot: next });
        }
    })().finally(() => { if (generation === settleGeneration) settling = null; });
    return settling;
};

type PomodoroStoreState = {
    snapshot: PomodoroSnapshot;
    hasHydrated: boolean;

    collapsed: boolean;

    /** The last 'focus-finished' was caused by the user (no completion alert for it). */
    quietFinish: boolean;

    hydratePomodoro: (autoStartOptions: PomodoroAutoStartOptions) => void;

    commitPomodoro: (updater: (prev: PomodoroSnapshot) => PomodoroSnapshot) => void;

    setPomodoroCollapsed: (collapsed: boolean) => void;

    startPomodoroFocusForTask: (taskId: string, autoStartOptions: PomodoroAutoStartOptions) => void;

    /** Add minutes to the current phase (running or paused). Returns the seconds actually added. */
    extendPomodoro: (minutes: number, autoStartOptions: PomodoroAutoStartOptions) => number;

    /** "Need more time?" after a check-in: keep going on the same task for a few minutes. */
    resumePomodoroFocus: (minutes: number, autoStartOptions: PomodoroAutoStartOptions) => number;
};

export const usePomodoroStore = createWithEqualityFn<PomodoroStoreState>((set, get) => ({
    snapshot: createInitialSnapshot(),
    hasHydrated: false,
    collapsed: readStoredCollapsed(),
    quietFinish: false,
    hydratePomodoro: (autoStartOptions) => {
        const nowMs = Date.now();


        get().snapshot.pendingCredits?.forEach((credit) => loadedCredits.add(credit));
        const stored = readStoredPomodoroSnapshot(nowMs);
        settleGeneration += 1;
        settling = null;
        quietFinishPending = false;
        const reconciled = withNewCredits(stored, applyKeepGoing(reconcilePomodoroSnapshot(stored, nowMs, autoStartOptions)));
        const saved = saveStoredPomodoroSnapshot(reconciled);
        set({ snapshot: reconciled, hasHydrated: true, ...(reconciled.lastEvent !== get().snapshot.lastEvent ? { quietFinish: quietFinishPending } : {}) });
        quietFinishPending = false;
        if (saved && reconciled.pendingCredits?.length) void settleCredits();
    },
    commitPomodoro: (updater) => {
        const prev = get().snapshot;
        const next = applyKeepGoing(updater(prev));


        if (!prev.timerState.isRunning && next.timerState.isRunning) {
            armPomodoroCompletionSound();
        }
        const credited = withNewCredits(prev, next);
        const saved = !isCountdownTickOnly(prev, credited) && saveStoredPomodoroSnapshot(credited);
        set({ snapshot: credited, ...(credited.lastEvent !== prev.lastEvent ? { quietFinish: quietFinishPending } : {}) });
        quietFinishPending = false;
        if (saved && credited.pendingCredits?.length) void settleCredits();
    },
    setPomodoroCollapsed: (collapsed) => {
        saveStoredCollapsed(collapsed);
        set({ collapsed });
    },
    startPomodoroFocusForTask: (taskId, autoStartOptions) => {
        if (!get().hasHydrated) {
            get().hydratePomodoro(autoStartOptions);
        }

        get().setPomodoroCollapsed(false);
        get().commitPomodoro((prev) => {
            const reconciled = reconcilePomodoroSnapshot(prev, Date.now(), autoStartOptions);
            return {
                ...reconciled,
                selectedTaskId: taskId,
                timerState: {
                    ...resetPomodoroState(reconciled.timerState, reconciled.durations, 'focus'),
                    isRunning: true,
                },
                lastEvent: null,
                updatedAtMs: Date.now(),
            };
        });
    },
    extendPomodoro: (minutes, autoStartOptions) => {
        let added = 0;
        get().commitPomodoro((prev) => {
            const reconciled = reconcilePomodoroSnapshot(prev, Date.now(), autoStartOptions);
            const result = extendPomodoroPhase(reconciled.timerState, reconciled.durations, minutes);
            added = result.addedSeconds;
            if (added <= 0) return prev;
            return { ...reconciled, timerState: result.state, updatedAtMs: Date.now() };
        });
        return added;
    },
    resumePomodoroFocus: (minutes, autoStartOptions) => {
        let added = 0;
        get().commitPomodoro((prev) => {
            const reconciled = reconcilePomodoroSnapshot(prev, Date.now(), autoStartOptions);
            const result = resumeFocusState(reconciled.timerState, reconciled.durations, minutes);
            added = result.addedSeconds;
            if (added <= 0) return prev;
            return { ...reconciled, timerState: result.state, lastEvent: null, updatedAtMs: Date.now() };
        });
        return added;
    },
}));
