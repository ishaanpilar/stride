import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '@stride/core';
import { createMobilePomodoroController } from './pomodoro-controller';
import { deriveFocusView, moveToPhase, secondsLeft, startFocusSession } from './focus-session';
import { focusSessionStore } from './focus-session-store';

const task = (patch: Partial<Task> = {}): Task => ({
    id: 'task-1', title: 'Write the report', status: 'next', tags: [], contexts: [],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...patch,
});

const memoryStorage = () => {
    const values = new Map<string, string>();
    return {
        getItem: vi.fn(async (key: string) => values.get(key) ?? null),
        setItem: vi.fn(async (key: string, value: string) => { values.set(key, value); }),
    };
};

const NO_AUTO = { autoStartBreaks: false, autoStartFocus: false };
const T0 = Date.parse('2026-11-05T09:00:00.000Z');

const makeController = (clock: { now: number }) => createMobilePomodoroController({
    storage: memoryStorage(),
    now: () => clock.now,
    getTaskStore: () => ({ tasks: [task()], updateTask: vi.fn(async () => ({ success: true })) }),
});

describe('secondsLeft', () => {
    it('counts down from the stored end timestamp, not from ticks', () => {
        const end = new Date(T0 + 25 * 60_000).toISOString();
        expect(secondsLeft(end, 1500, T0)).toBe(1500);
        expect(secondsLeft(end, 1500, T0 + 10 * 60_000)).toBe(900);
        expect(secondsLeft(end, 1500, T0 + 10 * 60_000 + 400)).toBe(900);
        expect(secondsLeft(end, 1500, T0 + 30 * 60_000)).toBe(0);
    });

    it('falls back to the paused remainder without an end time', () => {
        expect(secondsLeft(undefined, 733, T0)).toBe(733);
        expect(secondsLeft('not a date', 733, T0)).toBe(733);
    });
});

describe('startFocusSession', () => {
    beforeEach(() => focusSessionStore.reset());

    it('starts a focus phase on the task and opens the session', async () => {
        const clock = { now: T0 };
        const controller = makeController(clock);
        await expect(startFocusSession(controller, task(), NO_AUTO, 'full')).resolves.toBe('started');
        const state = controller.getSnapshot();
        expect(state.selectedTaskId).toBe('task-1');
        expect(state.timerState).toMatchObject({ phase: 'focus', isRunning: true });
        expect(state.phaseEndsAt).toBe(new Date(T0 + 25 * 60_000).toISOString());
        expect(focusSessionStore.getSnapshot()).toMatchObject({ open: true, presentation: 'full' });
    });

    it('opens as the mini bar when starting a Pomodoro', async () => {
        const controller = makeController({ now: T0 });
        await startFocusSession(controller, task(), NO_AUTO, 'mini');
        expect(focusSessionStore.getSnapshot().presentation).toBe('mini');
    });

    it('leaves a break phase and starts focus on the task', async () => {
        const controller = makeController({ now: T0 });
        await controller.ensureHydrated(NO_AUTO);
        controller.switchPhase(NO_AUTO);
        expect(controller.getSnapshot().timerState.phase).toBe('break');
        await startFocusSession(controller, task(), NO_AUTO, 'full');
        expect(controller.getSnapshot().timerState).toMatchObject({ phase: 'focus', isRunning: true });
    });

    it('switches the task without restarting a running focus phase', async () => {
        const controller = makeController({ now: T0 });
        await startFocusSession(controller, task(), NO_AUTO, 'full');
        const endsAt = controller.getSnapshot().phaseEndsAt;
        await expect(startFocusSession(controller, task({ id: 'task-2' }), NO_AUTO, 'full')).resolves.toBe('switched');
        expect(controller.getSnapshot().selectedTaskId).toBe('task-2');
        expect(controller.getSnapshot().phaseEndsAt).toBe(endsAt);
    });

    it('refuses tasks that are not actionable', async () => {
        const controller = makeController({ now: T0 });
        await expect(startFocusSession(controller, task({ status: 'done' }), NO_AUTO, 'full')).resolves.toBe('not-actionable');
        await expect(startFocusSession(controller, undefined, NO_AUTO, 'full')).resolves.toBe('not-actionable');
        expect(focusSessionStore.getSnapshot().open).toBe(false);
    });
});

describe('timer across backgrounding', () => {
    beforeEach(() => focusSessionStore.reset());

    it('reports the right remaining time after the app was suspended', async () => {
        const clock = { now: T0 };
        const controller = makeController(clock);
        await startFocusSession(controller, task(), NO_AUTO, 'full');
        clock.now = T0 + 7 * 60_000 + 30_000;
        controller.reconcile(NO_AUTO, clock.now);
        expect(controller.getSnapshot().timerState.remainingSeconds).toBe(25 * 60 - 7 * 60 - 30);
        expect(controller.getSnapshot().timerState.isRunning).toBe(true);
    });

    it('finishes the session when the phase ended while suspended', async () => {
        const clock = { now: T0 };
        const controller = makeController(clock);
        await startFocusSession(controller, task(), NO_AUTO, 'full');
        clock.now = T0 + 40 * 60_000;
        controller.reconcile(NO_AUTO, clock.now);
        const state = controller.getSnapshot();
        expect(state.lastEvent).toBe('focus-finished');
        expect(state.timerState.phase).toBe('break');
        expect(state.sessionHistory.totalCompletedFocusSessions).toBe(1);
    });

    it('keeps a paused remainder frozen while suspended', async () => {
        const clock = { now: T0 };
        const controller = makeController(clock);
        await startFocusSession(controller, task(), NO_AUTO, 'full');
        clock.now = T0 + 5 * 60_000;
        controller.toggle(NO_AUTO);
        const paused = controller.getSnapshot().timerState.remainingSeconds;
        clock.now = T0 + 50 * 60_000;
        controller.reconcile(NO_AUTO, clock.now);
        expect(controller.getSnapshot().timerState.remainingSeconds).toBe(paused);
        expect(paused).toBe(20 * 60);
    });
});

describe('moveToPhase', () => {
    it('moves to a running break after a finished session', async () => {
        const clock = { now: T0 };
        const controller = makeController(clock);
        await startFocusSession(controller, task(), NO_AUTO, 'full');
        clock.now = T0 + 26 * 60_000;
        controller.reconcile(NO_AUTO, clock.now);
        moveToPhase(controller, 'break', true, NO_AUTO);
        expect(controller.getSnapshot()).toMatchObject({ lastEvent: null, timerState: expect.objectContaining({ phase: 'break', isRunning: true }) });
    });
});

describe('deriveFocusView', () => {
    const base = { phase: 'focus' as const, isRunning: true, lastEvent: null, stepsDone: 0, stepsTotal: 0, celebrationAck: false, breakSkipped: false };

    it('shows the finish when a session ended or every step is done', () => {
        expect(deriveFocusView({ ...base, lastEvent: 'focus-finished' })).toBe('finish');
        expect(deriveFocusView({ ...base, stepsDone: 3, stepsTotal: 3 })).toBe('finish');
        expect(deriveFocusView({ ...base, stepsDone: 3, stepsTotal: 3, celebrationAck: true })).toBe('focus');
    });

    it('distinguishes break, ready and focus', () => {
        expect(deriveFocusView({ ...base, phase: 'break' })).toBe('break');
        expect(deriveFocusView({ ...base, isRunning: false, lastEvent: 'break-finished' })).toBe('ready');
        expect(deriveFocusView({ ...base, isRunning: false, breakSkipped: true })).toBe('ready');
        expect(deriveFocusView(base)).toBe('focus');
    });
});
