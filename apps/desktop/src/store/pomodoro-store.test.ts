import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logInfo, runStoreCommand, useTaskStore, type Task } from '@stride/core';

import {
    DESKTOP_POMODORO_COLLAPSED_STORAGE_KEY,
    DESKTOP_POMODORO_SESSION_STORAGE_KEY,
    reconcilePomodoroSnapshot,
    togglePomodoroSnapshot,
    usePomodoroStore,
} from './pomodoro-store';
import { armPomodoroCompletionSound } from '../lib/pomodoro-alert';
import { holdSyncSave } from '../test/hold-sync-save';
import { setPomodoroKeepGoing } from '../lib/pomodoro-preferences';

vi.mock('../lib/pomodoro-alert', () => ({
    armPomodoroCompletionSound: vi.fn(),
}));


const flush = vi.hoisted(() => ({ impl: async () => undefined as void }));
vi.mock('@stride/core', async (importOriginal) => ({
    ...await importOriginal<typeof import('@stride/core')>(),
    flushPendingSave: () => flush.impl(),
    logInfo: vi.fn(),
}));

const NOW_ISO = new Date().toISOString();

const task = (updates: Partial<Task> = {}): Task => ({
    id: 'task-1',
    title: 'Write report',
    status: 'next',
    tags: [],
    contexts: [],
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    ...updates,
});

const seedRunningSession = (options: {
    selectedTaskId?: string;
    focusMinutes?: number;
    remainingSeconds?: number;
    updatedAtMs?: number;
}) => {
    const focusMinutes = options.focusMinutes ?? 25;
    window.localStorage.setItem(DESKTOP_POMODORO_SESSION_STORAGE_KEY, JSON.stringify({
        durations: { focusMinutes, breakMinutes: 5 },
        timerState: {
            phase: 'focus',
            remainingSeconds: options.remainingSeconds ?? 5,
            isRunning: true,
            completedFocusSessions: 0,
        },
        selectedTaskId: options.selectedTaskId,
        updatedAtMs: options.updatedAtMs ?? Date.now() - 10_000,
        sessionHistory: { totalCompletedFocusSessions: 0, completedFocusSessionsByTaskId: {} },
    }));
};

let writeCount = 0;

describe('pomodoro store', () => {
    beforeEach(() => {
        window.localStorage.clear();
        writeCount = 0;
        const originalSetItem = window.localStorage.setItem.bind(window.localStorage);
        vi.spyOn(window.localStorage, 'setItem').mockImplementation((key: string, value: string) => {
            if (key === DESKTOP_POMODORO_SESSION_STORAGE_KEY) writeCount += 1;
            originalSetItem(key, value);
        });
        useTaskStore.setState({ tasks: [task()], _allTasks: [task()] } as never);
        usePomodoroStore.setState({ hasHydrated: false, collapsed: false, quietFinish: false });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        flush.impl = async () => undefined;
    });


    const restart = (savedTime: number | undefined, updates: Array<{ id: string; patch: Partial<Task> }>) => {
        useTaskStore.setState({
            tasks: [task({ timeSpentMinutes: savedTime })],
            _allTasks: [task({ timeSpentMinutes: savedTime })],
            updateTask: async (id: string, patch: Partial<Task>) => { updates.push({ id, patch }); },
        } as never);
        usePomodoroStore.setState({ hasHydrated: false });
        usePomodoroStore.getState().hydratePomodoro({});
    };

    it('credits once when the app quit before the task save landed', async () => {
        const updates: Array<{ id: string; patch: Partial<Task> }> = [];
        useTaskStore.setState({
            updateTask: async (id: string, patch: Partial<Task>) => { updates.push({ id, patch }); },
        } as never);
        flush.impl = () => new Promise<void>(() => undefined);
        seedRunningSession({ selectedTaskId: 'task-1', focusMinutes: 25 });

        usePomodoroStore.getState().hydratePomodoro({});
        await vi.waitFor(() => expect(updates).toHaveLength(1));


        flush.impl = async () => undefined;
        const after: Array<{ id: string; patch: Partial<Task> }> = [];
        restart(undefined, after);
        await vi.waitFor(() => expect(after).toEqual([{ id: 'task-1', patch: { timeSpentMinutes: 25 } }]));

        await vi.waitFor(() => expect(JSON.parse(window.localStorage.getItem(DESKTOP_POMODORO_SESSION_STORAGE_KEY)!).pendingCredits).toBeUndefined());
        const third: Array<{ id: string; patch: Partial<Task> }> = [];
        restart(25, third);
        await Promise.resolve();
        expect(third).toEqual([]);
    });

    it('retries a task save that failed without adding the time twice', async () => {
        const updates: Array<{ id: string; patch: Partial<Task> }> = [];
        useTaskStore.setState({
            updateTask: async (id: string, patch: Partial<Task>) => {
                updates.push({ id, patch });
                const current = useTaskStore.getState().tasks;
                useTaskStore.setState({ tasks: current.map((row) => (row.id === id ? { ...row, ...patch } : row)) } as never);
            },
        } as never);
        let failed = 0;
        flush.impl = async () => { failed += 1; throw new Error('disk full'); };
        seedRunningSession({ selectedTaskId: 'task-1', focusMinutes: 25 });

        usePomodoroStore.getState().hydratePomodoro({});
        await vi.waitFor(() => expect(failed).toBe(1));
        for (let i = 0; i < 10; i += 1) await Promise.resolve();
        expect(updates).toHaveLength(1);
        expect(JSON.parse(window.localStorage.getItem(DESKTOP_POMODORO_SESSION_STORAGE_KEY)!).pendingCredits)
            .toEqual([{ taskId: 'task-1', to: 25 }]);


        let saves = 0;
        flush.impl = async () => { saves += 1; };
        usePomodoroStore.getState().commitPomodoro((prev) => ({ ...prev, selectedTaskId: 'task-1', updatedAtMs: Date.now() }));
        await vi.waitFor(() => expect(JSON.parse(window.localStorage.getItem(DESKTOP_POMODORO_SESSION_STORAGE_KEY)!).pendingCredits).toBeUndefined());
        expect(updates).toEqual([{ id: 'task-1', patch: { timeSpentMinutes: 25 } }]);
        expect(saves).toBe(1);
    });

    it('leaves a credit owed from before a restart when the task\'s time moved since', async () => {

        window.localStorage.setItem(DESKTOP_POMODORO_SESSION_STORAGE_KEY, JSON.stringify({
            durations: { focusMinutes: 25, breakMinutes: 5 },
            timerState: { phase: 'break', remainingSeconds: 300, isRunning: false, completedFocusSessions: 1 },
            selectedTaskId: 'task-1',
            updatedAtMs: Date.now(),
            sessionHistory: { totalCompletedFocusSessions: 1, completedFocusSessionsByTaskId: { 'task-1': 1 } },
            pendingCredits: [{ taskId: 'task-1', from: 5, to: 30 }],
        }));
        const updates: Array<{ id: string; patch: Partial<Task> }> = [];
        restart(42, updates);
        await vi.waitFor(() => expect(JSON.parse(window.localStorage.getItem(DESKTOP_POMODORO_SESSION_STORAGE_KEY)!).pendingCredits).toBeUndefined());
        expect(updates).toEqual([]);
    });

    it('credits each session once when the panel hydrates again while a credit waits for its save', async () => {
        useTaskStore.setState({
            tasks: [task({ timeSpentMinutes: 5 })],
            _allTasks: [task({ timeSpentMinutes: 5 })],
            updateTask: async (id: string, patch: Partial<Task>) => {
                const current = useTaskStore.getState().tasks;
                useTaskStore.setState({ tasks: current.map((row) => (row.id === id ? { ...row, ...patch } : row)) } as never);
            },
        } as never);

        window.localStorage.setItem(DESKTOP_POMODORO_SESSION_STORAGE_KEY, JSON.stringify({
            durations: { focusMinutes: 25, breakMinutes: 5 },
            timerState: { phase: 'focus', remainingSeconds: 5, isRunning: true, completedFocusSessions: 1 },
            selectedTaskId: 'task-1',
            updatedAtMs: Date.now() - 10_000,
            sessionHistory: { totalCompletedFocusSessions: 1, completedFocusSessionsByTaskId: { 'task-1': 1 } },
            pendingCredits: [{ taskId: 'task-1', from: 5, to: 30 }],
        }));
        let release!: () => void;
        let saves = 0;
        flush.impl = () => { saves += 1; return saves === 1 ? new Promise<void>((resolve) => { release = resolve; }) : Promise.resolve(); };

        usePomodoroStore.getState().hydratePomodoro({});
        await vi.waitFor(() => expect(saves).toBe(1));

        usePomodoroStore.getState().hydratePomodoro({});
        await vi.waitFor(() => expect(saves).toBeGreaterThanOrEqual(2));
        for (let i = 0; i < 20; i += 1) await Promise.resolve();
        release();
        for (let i = 0; i < 50; i += 1) await Promise.resolve();
        expect(useTaskStore.getState().tasks[0].timeSpentMinutes).toBe(55);
    });

    it('stores a credit chained from a moved one at its moved time, so a quit before its save credits it once', async () => {
        useTaskStore.setState({
            tasks: [task({ timeSpentMinutes: 12 })],
            _allTasks: [task({ timeSpentMinutes: 12 })],
            updateTask: async (id: string, patch: Partial<Task>) => {
                const current = useTaskStore.getState().tasks;
                useTaskStore.setState({ tasks: current.map((row) => (row.id === id ? { ...row, ...patch } : row)) } as never);
            },
        } as never);

        window.localStorage.setItem(DESKTOP_POMODORO_SESSION_STORAGE_KEY, JSON.stringify({
            durations: { focusMinutes: 25, breakMinutes: 5 },
            timerState: { phase: 'focus', remainingSeconds: 5, isRunning: true, completedFocusSessions: 1 },
            selectedTaskId: 'task-1',
            updatedAtMs: Date.now() - 10_000,
            sessionHistory: { totalCompletedFocusSessions: 1, completedFocusSessionsByTaskId: { 'task-1': 1 } },
            pendingCredits: [{ taskId: 'task-1', from: 5, to: 30 }],
        }));
        usePomodoroStore.getState().hydratePomodoro({});

        usePomodoroStore.getState().commitPomodoro((prev) => ({ ...prev, sessionHistory: { ...prev.sessionHistory,
            totalCompletedFocusSessions: prev.sessionHistory.totalCompletedFocusSessions + 1,
            completedFocusSessionsByTaskId: { 'task-1': (prev.sessionHistory.completedFocusSessionsByTaskId['task-1'] ?? 0) + 1 } } }));

        await vi.waitFor(() => expect(JSON.parse(window.localStorage.getItem(DESKTOP_POMODORO_SESSION_STORAGE_KEY)!).pendingCredits)
            .toEqual([{ taskId: 'task-1', from: 37, to: 62 }]));
        expect(useTaskStore.getState().tasks[0].timeSpentMinutes).toBe(37);
        expect(logInfo).toHaveBeenCalledWith('Pomodoro credit moved onto the task time', {
            scope: 'pomodoro', context: { releaseCheck: 'v1.3.8/pomodoro-credit-moved', outcome: 'moved' } });
        const updates: Array<{ id: string; patch: Partial<Task> }> = [];
        restart(37, updates);
        await vi.waitFor(() => expect(updates).toEqual([{ id: 'task-1', patch: { timeSpentMinutes: 62 } }]));
    });

    it('stores a credit moved by a sync save before giving it, so a quit then credits it once', async () => {
        const updates: Array<{ id: string; patch: Partial<Task> }> = [];
        useTaskStore.setState({
            tasks: [task({ timeSpentMinutes: 50 })],
            _allTasks: [task({ timeSpentMinutes: 50 })],
            updateTask: (id: string, patch: Partial<Task>) => runStoreCommand(async () => { updates.push({ id, patch }); }),
        } as never);
        flush.impl = () => new Promise<void>(() => undefined);
        seedRunningSession({ selectedTaskId: 'task-1', focusMinutes: 25 });
        const finish = holdSyncSave(() => useTaskStore.setState({ tasks: [task({ timeSpentMinutes: 60 })] } as never));

        usePomodoroStore.getState().hydratePomodoro({});
        await finish();
        await vi.waitFor(() => expect(updates).toEqual([{ id: 'task-1', patch: { timeSpentMinutes: 85 } }]));
        expect(JSON.parse(window.localStorage.getItem(DESKTOP_POMODORO_SESSION_STORAGE_KEY)!).pendingCredits)
            .toEqual([{ taskId: 'task-1', from: 60, to: 85 }]);
    });

    it('retries the save of a written credit when the panel hydrates again, and keeps it owed while saves fail', async () => {
        const updates: Array<{ id: string; patch: Partial<Task> }> = [];
        useTaskStore.setState({
            updateTask: async (id: string, patch: Partial<Task>) => {
                updates.push({ id, patch });
                const current = useTaskStore.getState().tasks;
                useTaskStore.setState({ tasks: current.map((row) => (row.id === id ? { ...row, ...patch } : row)) } as never);
            },
        } as never);
        let failed = 0;
        flush.impl = async () => { failed += 1; throw new Error('disk full'); };
        seedRunningSession({ selectedTaskId: 'task-1', focusMinutes: 25 });

        usePomodoroStore.getState().hydratePomodoro({});
        await vi.waitFor(() => expect(failed).toBe(1));
        usePomodoroStore.getState().hydratePomodoro({});
        await vi.waitFor(() => expect(failed).toBe(2));
        for (let i = 0; i < 10; i += 1) await Promise.resolve();
        expect(updates).toHaveLength(1);
        expect(JSON.parse(window.localStorage.getItem(DESKTOP_POMODORO_SESSION_STORAGE_KEY)!).pendingCredits)
            .toEqual([{ taskId: 'task-1', to: 25 }]);
    });

    it('keeps a credit owed when the store gave up on its save, though the next flush resolves', async () => {
        useTaskStore.setState({
            updateTask: async (id: string, patch: Partial<Task>) => {
                const current = useTaskStore.getState().tasks;

                useTaskStore.setState({
                    tasks: current.map((row) => (row.id === id ? { ...row, ...patch } : row)),
                    persistenceFailure: { message: 'disk full', at: Date.now() },
                } as never);
            },
        } as never);
        seedRunningSession({ selectedTaskId: 'task-1', focusMinutes: 25 });
        try {
            usePomodoroStore.getState().hydratePomodoro({});
            await vi.waitFor(() => expect(useTaskStore.getState().tasks[0].timeSpentMinutes).toBe(25));
            for (let i = 0; i < 10; i += 1) await Promise.resolve();
            expect(JSON.parse(window.localStorage.getItem(DESKTOP_POMODORO_SESSION_STORAGE_KEY)!).pendingCredits)
                .toEqual([{ taskId: 'task-1', to: 25 }]);
        } finally {
            useTaskStore.setState({ persistenceFailure: null } as never);
        }
    });

    it('does not credit twice when the session could not be saved', async () => {
        const updates: Array<{ id: string; patch: Partial<Task> }> = [];
        useTaskStore.setState({
            updateTask: async (id: string, patch: Partial<Task>) => { updates.push({ id, patch }); },
        } as never);
        seedRunningSession({ selectedTaskId: 'task-1', focusMinutes: 25 });
        vi.mocked(window.localStorage.setItem).mockImplementation(() => { throw new Error('quota exceeded'); });

        usePomodoroStore.getState().hydratePomodoro({});
        await Promise.resolve();
        await Promise.resolve();


        expect(updates).toEqual([]);
        vi.mocked(window.localStorage.setItem).mockRestore();
        const after: Array<{ id: string; patch: Partial<Task> }> = [];
        restart(undefined, after);
        await vi.waitFor(() => expect(after).toEqual([{ id: 'task-1', patch: { timeSpentMinutes: 25 } }]));
    });

    it('credits a focus session completed while the app was closed to the linked task', () => {
        const updates: Array<{ id: string; patch: Partial<Task> }> = [];
        useTaskStore.setState({
            updateTask: async (id: string, patch: Partial<Task>) => {
                updates.push({ id, patch });
            },
        } as never);
        seedRunningSession({ selectedTaskId: 'task-1', focusMinutes: 25 });

        usePomodoroStore.getState().hydratePomodoro({});

        expect(updates).toEqual([{ id: 'task-1', patch: { timeSpentMinutes: 25 } }]);
        const history = usePomodoroStore.getState().snapshot.sessionHistory;
        expect(history.completedFocusSessionsByTaskId['task-1']).toBe(1);
    });

    it('adds to an existing time-spent total instead of replacing it', () => {
        const updates: Array<{ id: string; patch: Partial<Task> }> = [];
        useTaskStore.setState({
            tasks: [task({ timeSpentMinutes: 50 })],
            _allTasks: [task({ timeSpentMinutes: 50 })],
            updateTask: async (id: string, patch: Partial<Task>) => {
                updates.push({ id, patch });
            },
        } as never);
        seedRunningSession({ selectedTaskId: 'task-1', focusMinutes: 25 });

        usePomodoroStore.getState().hydratePomodoro({});

        expect(updates).toEqual([{ id: 'task-1', patch: { timeSpentMinutes: 75 } }]);
    });

    it('adds to the total a sync save published while the credit waited', async () => {
        const updates: Array<{ id: string; patch: Partial<Task> }> = [];
        useTaskStore.setState({
            tasks: [task({ timeSpentMinutes: 50 })],
            _allTasks: [task({ timeSpentMinutes: 50 })],

            updateTask: (id: string, patch: Partial<Task>) => runStoreCommand(async () => { updates.push({ id, patch }); }),
        } as never);
        seedRunningSession({ selectedTaskId: 'task-1', focusMinutes: 25 });

        const finish = holdSyncSave(() => useTaskStore.setState({ tasks: [task({ timeSpentMinutes: 60 })] } as never));

        usePomodoroStore.getState().hydratePomodoro({});
        await finish();
        await vi.waitFor(() => expect(updates).toHaveLength(1));

        expect(updates).toEqual([{ id: 'task-1', patch: { timeSpentMinutes: 85 } }]);
    });

    it('does not touch tasks when the completed session has no linked task', () => {
        const updates: Array<{ id: string; patch: Partial<Task> }> = [];
        useTaskStore.setState({
            updateTask: async (id: string, patch: Partial<Task>) => {
                updates.push({ id, patch });
            },
        } as never);
        seedRunningSession({ focusMinutes: 25 });

        usePomodoroStore.getState().hydratePomodoro({});

        expect(updates).toEqual([]);
        expect(usePomodoroStore.getState().snapshot.sessionHistory.totalCompletedFocusSessions).toBe(1);
    });


    it('arms the completion chime on the stopped-to-running transition only', () => {
        vi.mocked(armPomodoroCompletionSound).mockClear();
        usePomodoroStore.getState().hydratePomodoro({});
        usePomodoroStore.getState().commitPomodoro((prev) => ({
            ...prev,
            timerState: { ...prev.timerState, isRunning: true },
            updatedAtMs: Date.now(),
        }));
        expect(armPomodoroCompletionSound).toHaveBeenCalledTimes(1);


        usePomodoroStore.getState().commitPomodoro((prev) => ({
            ...prev,
            timerState: { ...prev.timerState, remainingSeconds: prev.timerState.remainingSeconds - 1 },
            updatedAtMs: Date.now(),
        }));
        expect(armPomodoroCompletionSound).toHaveBeenCalledTimes(1);
    });

    it('starts a linked focus session from a task via quick start', () => {
        usePomodoroStore.getState().hydratePomodoro({});
        usePomodoroStore.getState().startPomodoroFocusForTask('task-1', {});

        const snapshot = usePomodoroStore.getState().snapshot;
        expect(snapshot.selectedTaskId).toBe('task-1');
        expect(snapshot.timerState.phase).toBe('focus');
        expect(snapshot.timerState.isRunning).toBe(true);

        const stored = JSON.parse(window.localStorage.getItem(DESKTOP_POMODORO_SESSION_STORAGE_KEY) ?? '{}');
        expect(stored.selectedTaskId).toBe('task-1');
        expect(stored.timerState.isRunning).toBe(true);
    });

    it('hydrates lazily when quick start is the first pomodoro interaction', () => {
        seedRunningSession({ selectedTaskId: undefined, focusMinutes: 25, remainingSeconds: 120 });

        usePomodoroStore.getState().startPomodoroFocusForTask('task-1', {});

        const snapshot = usePomodoroStore.getState().snapshot;
        expect(snapshot.selectedTaskId).toBe('task-1');
        expect(snapshot.timerState.isRunning).toBe(true);
        expect(snapshot.durations.focusMinutes).toBe(25);
    });

    it('skips the storage write for a plain countdown tick but restores the same clock', () => {
        seedRunningSession({ selectedTaskId: 'task-1', focusMinutes: 25, remainingSeconds: 300, updatedAtMs: Date.now() });
        usePomodoroStore.getState().hydratePomodoro({});
        const writesAfterHydrate = writeCount;
        const hydratedAtMs = usePomodoroStore.getState().snapshot.updatedAtMs;


        for (let second = 1; second <= 10; second += 1) {
            usePomodoroStore.getState().commitPomodoro((prev) => reconcilePomodoroSnapshot(prev, hydratedAtMs + second * 1000, {}));
        }
        expect(usePomodoroStore.getState().snapshot.timerState.remainingSeconds).toBe(290);
        expect(writeCount).toBe(writesAfterHydrate);


        usePomodoroStore.setState({ hasHydrated: false });
        const stored = JSON.parse(window.localStorage.getItem(DESKTOP_POMODORO_SESSION_STORAGE_KEY) ?? '{}');
        const elapsed = Math.floor((hydratedAtMs + 10_000 - stored.updatedAtMs) / 1000);
        expect(stored.timerState.remainingSeconds - elapsed).toBe(290);


        usePomodoroStore.getState().commitPomodoro((prev) => ({
            ...prev,
            timerState: { ...prev.timerState, isRunning: false },
        }));
        expect(writeCount).toBe(writesAfterHydrate + 1);
    });

    it('persists the collapsed preference to its own local-storage key', () => {
        usePomodoroStore.getState().setPomodoroCollapsed(true);

        expect(usePomodoroStore.getState().collapsed).toBe(true);
        expect(window.localStorage.getItem(DESKTOP_POMODORO_COLLAPSED_STORAGE_KEY)).toBe('true');

        usePomodoroStore.getState().setPomodoroCollapsed(false);

        expect(usePomodoroStore.getState().collapsed).toBe(false);
        expect(window.localStorage.getItem(DESKTOP_POMODORO_COLLAPSED_STORAGE_KEY)).toBe('false');
    });

    it('un-collapses the panel when a task quick-starts its timer', () => {
        usePomodoroStore.getState().setPomodoroCollapsed(true);
        expect(usePomodoroStore.getState().collapsed).toBe(true);

        usePomodoroStore.getState().startPomodoroFocusForTask('task-1', {});

        expect(usePomodoroStore.getState().collapsed).toBe(false);
        expect(window.localStorage.getItem(DESKTOP_POMODORO_COLLAPSED_STORAGE_KEY)).toBe('false');
    });

    describe('adding time', () => {
        const stored = () => JSON.parse(window.localStorage.getItem(DESKTOP_POMODORO_SESSION_STORAGE_KEY) ?? '{}');

        it('extends a running phase, saves it for the other windows and keeps it after a re-read', () => {
            seedRunningSession({ selectedTaskId: 'task-1', remainingSeconds: 1500, updatedAtMs: Date.now() });
            usePomodoroStore.getState().hydratePomodoro({});
            const added = usePomodoroStore.getState().extendPomodoro(5, {});
            expect(added).toBe(300);
            const { timerState } = usePomodoroStore.getState().snapshot;
            expect(timerState.isRunning).toBe(true);
            expect(timerState.remainingSeconds).toBeGreaterThanOrEqual(1799);
            expect(timerState.phaseTotalSeconds).toBe(1800);
            expect(stored().timerState.phaseTotalSeconds).toBe(1800);

            // Another window (the menu bar panel, the float's owner) reads the same snapshot.
            usePomodoroStore.setState({ hasHydrated: false });
            usePomodoroStore.getState().hydratePomodoro({});
            const reread = usePomodoroStore.getState().snapshot.timerState;
            // More than the configured 25 minutes: the added time survives the re-read.
            expect(reread.remainingSeconds).toBeGreaterThan(25 * 60);
            expect(reread.phaseTotalSeconds).toBe(1800);
            expect(reread.extendedSeconds).toBe(300);
        });

        it('extends a paused phase without starting it', () => {
            usePomodoroStore.getState().hydratePomodoro({});
            usePomodoroStore.getState().commitPomodoro((prev) => ({ ...prev, timerState: { ...prev.timerState, remainingSeconds: 100 } }));
            usePomodoroStore.getState().extendPomodoro(10, {});
            const { timerState } = usePomodoroStore.getState().snapshot;
            expect(timerState).toMatchObject({ isRunning: false, remainingSeconds: 700, phaseTotalSeconds: 2100 });
        });

        it('stops at the per-phase cap', () => {
            usePomodoroStore.getState().hydratePomodoro({});
            const total = [60, 60, 60].reduce((sum, minutes) => sum + usePomodoroStore.getState().extendPomodoro(minutes, {}), 0);
            expect(total).toBe(120 * 60);
            expect(usePomodoroStore.getState().extendPomodoro(5, {})).toBe(0);
        });

        it('rejects a stored extension past the cap and clamps the time to the phase', () => {
            window.localStorage.setItem(DESKTOP_POMODORO_SESSION_STORAGE_KEY, JSON.stringify({
                durations: { focusMinutes: 25, breakMinutes: 5 },
                timerState: { phase: 'focus', remainingSeconds: 99_999, isRunning: false, completedFocusSessions: 0, phaseTotalSeconds: 99_999, extendedSeconds: 99_999 },
                updatedAtMs: Date.now(),
                sessionHistory: { totalCompletedFocusSessions: 0, completedFocusSessionsByTaskId: {} },
            }));
            usePomodoroStore.getState().hydratePomodoro({});
            const { timerState } = usePomodoroStore.getState().snapshot;
            expect(timerState.phaseTotalSeconds).toBe(25 * 60 + 120 * 60);
            expect(timerState.remainingSeconds).toBe(25 * 60 + 120 * 60);
        });

        it('credits the added minutes when an extended focus finishes', () => {
            setPomodoroKeepGoing(false);
            const updates: Array<{ id: string; patch: Partial<Task> }> = [];
            useTaskStore.setState({ updateTask: async (id: string, patch: Partial<Task>) => { updates.push({ id, patch }); } } as never);
            seedRunningSession({ selectedTaskId: 'task-1', remainingSeconds: 5, updatedAtMs: Date.now() });
            usePomodoroStore.getState().hydratePomodoro({});
            usePomodoroStore.getState().extendPomodoro(10, {});
            const startedAt = usePomodoroStore.getState().snapshot.updatedAtMs;
            usePomodoroStore.getState().commitPomodoro((prev) => reconcilePomodoroSnapshot(prev, startedAt + 700_000, {}));
            expect(usePomodoroStore.getState().snapshot.lastEvent).toBe('focus-finished');
            expect(updates).toEqual([{ id: 'task-1', patch: { timeSpentMinutes: 35 } }]);
        });

        it('resumes the same task for a few minutes after a finished session', () => {
            usePomodoroStore.getState().hydratePomodoro({});
            usePomodoroStore.getState().commitPomodoro((prev) => ({
                ...prev,
                selectedTaskId: 'task-1',
                timerState: { ...prev.timerState, phase: 'break', remainingSeconds: 300, isRunning: false },
                lastEvent: 'focus-finished',
            }));
            usePomodoroStore.getState().resumePomodoroFocus(5, {});
            const snapshot = usePomodoroStore.getState().snapshot;
            expect(snapshot.selectedTaskId).toBe('task-1');
            expect(snapshot.lastEvent).toBeNull();
            expect(snapshot.timerState).toMatchObject({ phase: 'focus', isRunning: true, remainingSeconds: 300, phaseTotalSeconds: 300 });
        });
    });

    describe('keep going (overtime)', () => {
        const updates: Array<{ id: string; patch: Partial<Task> }> = [];
        const startLinked = (remainingSeconds: number) => {
            updates.length = 0;
            useTaskStore.setState({ updateTask: async (id: string, patch: Partial<Task>) => { updates.push({ id, patch }); } } as never);
            seedRunningSession({ selectedTaskId: 'task-1', remainingSeconds, updatedAtMs: Date.now() });
            usePomodoroStore.getState().hydratePomodoro({});
            return usePomodoroStore.getState().snapshot.updatedAtMs;
        };
        const tick = (atMs: number) => usePomodoroStore.getState().commitPomodoro((prev) => reconcilePomodoroSnapshot(prev, atMs, {}));

        it('a focus with an open task counts up past 0:00 instead of ending, and says so once', () => {
            const t0 = startLinked(5);
            expect(usePomodoroStore.getState().snapshot.timerState.keepGoing).toBe(true);
            tick(t0 + 5_000);
            let snapshot = usePomodoroStore.getState().snapshot;
            expect(snapshot.lastEvent).toBe('focus-overtime');
            expect(snapshot.timerState).toMatchObject({ phase: 'focus', isRunning: true, remainingSeconds: 0, overtimeSeconds: 0 });
            // Saved for the other windows (menu bar, float).
            expect(JSON.parse(window.localStorage.getItem(DESKTOP_POMODORO_SESSION_STORAGE_KEY) ?? '{}').timerState.overtimeSeconds).toBe(0);
            tick(t0 + 95_000);
            snapshot = usePomodoroStore.getState().snapshot;
            expect(snapshot.timerState.overtimeSeconds).toBe(90);
            expect(snapshot.lastEvent).toBe('focus-overtime');
            expect(updates).toEqual([]);
        });

        it('Pause in overtime ends the session quietly; the overtime counts toward stats and time spent', () => {
            const t0 = startLinked(5);
            tick(t0 + 5_000 + 600_000);
            usePomodoroStore.getState().commitPomodoro((prev) => togglePomodoroSnapshot(prev, t0 + 605_000, {}));
            const state = usePomodoroStore.getState();
            expect(state.snapshot.lastEvent).toBe('focus-finished');
            expect(state.quietFinish).toBe(true);
            expect(state.snapshot.timerState).toMatchObject({ phase: 'break', isRunning: false, completedFocusSessions: 1 });
            expect(state.snapshot.timerState.lastFocusSeconds).toBe(25 * 60 + 600);
            expect(state.snapshot.sessionHistory.completedFocusSessionsByTaskId['task-1']).toBe(1);
            expect(updates).toEqual([{ id: 'task-1', patch: { timeSpentMinutes: 35 } }]);
        });

        it('ticking the task done (anywhere) ends the overtime', () => {
            const t0 = startLinked(5);
            tick(t0 + 65_000);
            const done = { ...useTaskStore.getState().tasks[0]!, status: 'done' as const };
            useTaskStore.setState({ tasks: [done], _allTasks: [done] } as never);
            tick(t0 + 66_000);
            const snapshot = usePomodoroStore.getState().snapshot;
            expect(snapshot.lastEvent).toBe('focus-finished');
            expect(snapshot.timerState.phase).toBe('break');
            expect(usePomodoroStore.getState().quietFinish).toBe(true);
        });

        it('the overtime cap stops the session and brings the check-in (with an alert)', () => {
            const t0 = startLinked(5);
            tick(t0 + 5_000);
            tick(t0 + 5_000 + 60 * 60_000);
            const state = usePomodoroStore.getState();
            expect(state.snapshot.lastEvent).toBe('focus-finished');
            expect(state.quietFinish).toBe(false);
            expect(state.snapshot.timerState).toMatchObject({ phase: 'break', isRunning: false });
            expect(updates).toEqual([{ id: 'task-1', patch: { timeSpentMinutes: 85 } }]);
        });

        it('with the setting off, or no task, the phase ends at 0:00 as before', () => {
            setPomodoroKeepGoing(false);
            let t0 = startLinked(5);
            expect(usePomodoroStore.getState().snapshot.timerState.keepGoing).toBeUndefined();
            tick(t0 + 5_000);
            expect(usePomodoroStore.getState().snapshot.lastEvent).toBe('focus-finished');
            setPomodoroKeepGoing(true);
            window.localStorage.removeItem(DESKTOP_POMODORO_SESSION_STORAGE_KEY);
            seedRunningSession({ remainingSeconds: 5, updatedAtMs: Date.now() });
            usePomodoroStore.getState().hydratePomodoro({});
            t0 = usePomodoroStore.getState().snapshot.updatedAtMs;
            tick(t0 + 5_000);
            expect(usePomodoroStore.getState().snapshot.lastEvent).toBe('focus-finished');
        });

        it('another window re-reading the snapshot continues the same overtime', () => {
            const t0 = startLinked(5);
            tick(t0 + 5_000);
            usePomodoroStore.setState({ hasHydrated: false });
            usePomodoroStore.getState().hydratePomodoro({});
            const timer = usePomodoroStore.getState().snapshot.timerState;
            expect(timer.phase).toBe('focus');
            expect(timer.overtimeSeconds).toBeGreaterThanOrEqual(0);
            expect(timer.remainingSeconds).toBe(0);
        });
    });
});
