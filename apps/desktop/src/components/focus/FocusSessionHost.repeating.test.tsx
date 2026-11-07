import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createPomodoroState, DEFAULT_POMODORO_DURATIONS, useTaskStore, type Task } from '@stride/core';
import { LanguageProvider } from '../../contexts/language-context';
import { resetCompletionSequenceForTests } from '../../lib/completion-sequence';
import { resetCompletionRetentionForTests } from '../../lib/completion-retention';
import { resetRepeatTickGuardForTests } from '../../lib/repeating-completion';
import { usePomodoroStore } from '../../store/pomodoro-store';
import { resetFocusSessionStore } from '../../store/focus-session-store';
import { PomodoroPanel } from '../views/PomodoroPanel';
import { FocusSessionHost } from './FocusSessionHost';

vi.mock('../../lib/report-error', () => ({ reportError: vi.fn() }));
vi.mock('../../lib/window-fullscreen', () => ({
    isWindowFullscreen: vi.fn(async () => false),
    setWindowFullscreen: vi.fn(async () => false),
}));
vi.mock('../../lib/focus-ai-service', async () => {
    const core = await vi.importActual<typeof import('@stride/core')>('@stride/core');
    return {
        isFocusAiEnabled: () => false,
        requestFocusCoach: vi.fn(async (_key: string, input: never, options: { tr?: never; seed?: number }) => core.generateFocusCoach(null, input, options)),
        requestFocusCoachReply: vi.fn(async (input: never, turns: never) => core.generateFocusCoachReply(null, input, turns, { now: new Date() })),
        requestFocusEncouragement: vi.fn(async () => null),
        resetFocusAiCacheForTests: () => undefined,
    };
});

const stamp = '2026-01-01T00:00:00.000Z';
const dayKey = (offset: number) => {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const weekly: Task = {
    id: 'weekly', title: 'Call Brian', status: 'next', tags: [], contexts: [], createdAt: stamp, updatedAt: stamp,
    dueDate: dayKey(3), recurrence: { rule: 'weekly', strategy: 'fluid' },
};
const allTasks = () => useTaskStore.getState()._allTasks;
const openOccurrences = () => allTasks().filter((task) => task.title === 'Call Brian' && task.status !== 'done' && !task.deletedAt);
const nextOccurrence = () => allTasks().find((task) => task.id !== 'weekly' && task.recurrence && !task.deletedAt);

const finishSession = (selectedTaskId: string) => {
    // The Today card sits behind the stage: it must not unlink the task while the check-in shows it.
    render(<LanguageProvider><PomodoroPanel tasks={[]} /><FocusSessionHost /></LanguageProvider>);
    const base = usePomodoroStore.getState().snapshot;
    const timerState = createPomodoroState(DEFAULT_POMODORO_DURATIONS);
    act(() => { usePomodoroStore.setState({ hasHydrated: true, snapshot: { ...base, selectedTaskId, timerState: { ...timerState, isRunning: true } } }); });
    act(() => { usePomodoroStore.setState({ snapshot: { ...usePomodoroStore.getState().snapshot, lastEvent: 'focus-finished', timerState } }); });
    return screen.getByTestId('focus-checkin');
};
const pressDone = async (checkIn: HTMLElement) => {
    await act(async () => { fireEvent.click(within(checkIn).getByRole('button', { name: 'Done' })); });
};

describe('FocusSessionHost: Done on a repeating task', () => {
    beforeEach(() => {
        window.localStorage.clear();
        resetFocusSessionStore();
        resetCompletionRetentionForTests();
        resetCompletionSequenceForTests();
        resetRepeatTickGuardForTests();
        useTaskStore.setState({
            tasks: [weekly], _allTasks: [weekly], projects: [], _allProjects: [], areas: [], _allAreas: [],
            settings: { deviceId: 'test-device' }, error: null, highlightTaskId: null, lastDataChangeAt: 0,
        });
    });
    afterEach(() => {
        resetCompletionSequenceForTests();
        resetCompletionRetentionForTests();
        resetRepeatTickGuardForTests();
    });

    it('says when it repeats next, with Undo that takes the new occurrence back', async () => {
        const checkIn = finishSession('weekly');
        await pressDone(checkIn);
        expect(openOccurrences()).toHaveLength(1);
        expect(usePomodoroStore.getState().snapshot.selectedTaskId).toBe('weekly');
        const line = screen.getByTestId('focus-checkin-done-line');
        expect(line).toHaveTextContent(/^Done\. Repeats next on /);
        await act(async () => { fireEvent.click(within(line).getByRole('button', { name: 'Undo' })); });
        expect(allTasks().find((task) => task.id === 'weekly')?.status).toBe('next');
        // One open task again: the occurrence this Done created is gone.
        expect(openOccurrences().map((task) => task.id)).toEqual(['weekly']);
        expect(within(screen.getByTestId('focus-checkin')).getByRole('button', { name: 'Done' })).toBeInTheDocument();
    });

    it('Stop repeating ends the series, undoably', async () => {
        const checkIn = finishSession('weekly');
        await pressDone(checkIn);
        const next = nextOccurrence()!;
        const line = screen.getByTestId('focus-checkin-done-line');
        await act(async () => { fireEvent.click(within(line).getByRole('button', { name: 'Stop repeating' })); });
        expect(line).toHaveTextContent('Stopped repeating');
        expect(allTasks().find((task) => task.id === next.id)?.deletedAt).toBeTruthy();
        await act(async () => { fireEvent.click(within(line).getByRole('button', { name: 'Undo' })); });
        expect(allTasks().find((task) => task.id === next.id)?.deletedAt).toBeFalsy();
        expect(allTasks().find((task) => task.id === next.id)?.recurrence).toBeTruthy();
        expect(line).toHaveTextContent(/Done\. Repeats next on /);
    });

    it('a Done right after the last occurrence asks first, in the check-in; Cancel leaves the task open', async () => {
        const justDone: Task = { ...weekly, status: 'done', completedAt: new Date().toISOString(), recurrence: { rule: 'weekly', strategy: 'fluid', seriesId: 'weekly' } };
        const current: Task = { ...weekly, id: 'current', recurrence: { rule: 'weekly', strategy: 'fluid', seriesId: 'weekly' } };
        useTaskStore.setState({ tasks: [current], _allTasks: [justDone, current] });
        const map = useTaskStore.getState()._tasksById as Map<string, Task>;
        map.set('weekly', justDone);
        map.set('current', current);

        const checkIn = finishSession('current');
        await pressDone(checkIn);
        const ask = within(checkIn).getByTestId('repeat-tick-confirm');
        expect(ask).toHaveTextContent("This repeats. Mark next week's as done too?");
        expect(allTasks().find((task) => task.id === 'current')?.status).toBe('next');
        fireEvent.click(within(ask).getByRole('button', { name: 'Cancel' }));
        expect(within(checkIn).queryByTestId('repeat-tick-confirm')).toBeNull();
        expect(allTasks().find((task) => task.id === 'current')?.status).toBe('next');

        await pressDone(checkIn);
        await act(async () => { fireEvent.click(within(within(checkIn).getByTestId('repeat-tick-confirm')).getByRole('button', { name: 'Yes' })); });
        expect(allTasks().find((task) => task.id === 'current')?.status).toBe('done');
        expect(screen.getByTestId('focus-checkin-done-line')).toHaveTextContent(/Done\. Repeats next on /);
    });

    it('a plain task keeps "Marked done"', async () => {
        const plain: Task = { ...weekly, id: 'plain', recurrence: undefined };
        useTaskStore.setState({ tasks: [plain], _allTasks: [plain] });
        (useTaskStore.getState()._tasksById as Map<string, Task>).set('plain', plain);
        const checkIn = finishSession('plain');
        await pressDone(checkIn);
        const line = screen.getByTestId('focus-checkin-done-line');
        expect(line).toHaveTextContent('Marked done');
        expect(within(line).queryByRole('button', { name: 'Stop repeating' })).toBeNull();
    });
});
