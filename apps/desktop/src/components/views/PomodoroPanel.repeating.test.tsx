import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useTaskStore, type Task } from '@stride/core';
import { LanguageProvider } from '../../contexts/language-context';
import { resetCompletionRetentionForTests } from '../../lib/completion-retention';
import { COMPLETION_GONE_LINGER_MS, COMPLETION_TIMELINE, resetCompletionSequenceForTests } from '../../lib/completion-sequence';
import { resetRepeatTickGuardForTests } from '../../lib/repeating-completion';
import { usePomodoroStore } from '../../store/pomodoro-store';
import { useUiStore } from '../../store/ui-store';
import { DESKTOP_POMODORO_SESSION_STORAGE_KEY, PomodoroPanel } from './PomodoroPanel';

vi.mock('../../lib/report-error', () => ({ reportError: vi.fn() }));

const stamp = '2026-01-01T00:00:00.000Z';
const dayKey = (offset: number) => {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const weekly: Task = {
    id: 'weekly', title: 'Call Brian', status: 'next', tags: [], contexts: [], createdAt: stamp, updatedAt: stamp,
    dueDate: dayKey(3), recurrence: { rule: 'weekly', strategy: 'fluid', seriesId: 'weekly' },
};
const allTasks = () => useTaskStore.getState()._allTasks;
const openCopies = () => allTasks().filter((task) => task.title === 'Call Brian' && task.status !== 'done' && !task.deletedAt);
const lastToast = () => useUiStore.getState().toasts.slice(-1)[0];

const seed = (tasks: Task[], selectedTaskId: string) => {
    useTaskStore.setState({
        tasks: tasks.filter((task) => task.status !== 'done'), _allTasks: tasks, projects: [], _allProjects: [], areas: [], _allAreas: [],
        settings: { deviceId: 'test-device' }, error: null, highlightTaskId: null, lastDataChangeAt: 0,
    });
    const byId = useTaskStore.getState()._tasksById as Map<string, Task>;
    tasks.forEach((task) => byId.set(task.id, task));
    window.localStorage.setItem(DESKTOP_POMODORO_SESSION_STORAGE_KEY, JSON.stringify({
        durations: { focusMinutes: 25, breakMinutes: 5 },
        timerState: { phase: 'focus', remainingSeconds: 1500, isRunning: false, completedFocusSessions: 0 },
        selectedTaskId,
        updatedAtMs: Date.now(),
        sessionHistory: { totalCompletedFocusSessions: 0, completedFocusSessionsByTaskId: {} },
    }));
    usePomodoroStore.setState({ hasHydrated: false });
};
const renderPanel = (tasks: Task[]) => render(<LanguageProvider><PomodoroPanel tasks={tasks} /></LanguageProvider>);
const markDone = async () => {
    await act(async () => {
        fireEvent.click(screen.getByLabelText('Mark task done'));
        await Promise.resolve();
    });
};
const playSequence = async () => {
    await act(async () => { vi.advanceTimersByTime(COMPLETION_TIMELINE.gone + 1); });
    await act(async () => { vi.advanceTimersByTime(COMPLETION_GONE_LINGER_MS + 1); });
};

describe('PomodoroPanel: Mark done on a repeating task', () => {
    const initialUi = useUiStore.getState();
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
        window.localStorage.clear();
        resetCompletionRetentionForTests();
        resetCompletionSequenceForTests();
        resetRepeatTickGuardForTests();
        useUiStore.setState(initialUi, true);
        useUiStore.setState({ toasts: [] });
    });
    afterEach(() => {
        resetCompletionSequenceForTests();
        resetCompletionRetentionForTests();
        resetRepeatTickGuardForTests();
        vi.useRealTimers();
    });

    it('shows "Done. Repeats next on …" with Undo and Stop repeating, like a tick', async () => {
        seed([weekly], 'weekly');
        renderPanel([weekly]);
        await markDone();
        expect(openCopies()).toHaveLength(1);
        expect(useUiStore.getState().toasts).toHaveLength(0);
        await playSequence();
        const toast = lastToast()!;
        expect(toast.message).toMatch(/^Done\. Repeats next on /);
        expect(toast.action?.label).toBe('Undo');
        expect(toast.secondaryAction?.label).toBe('Stop repeating');
        await act(async () => {
            toast.action!.onClick();
            await vi.advanceTimersByTimeAsync(1);
        });
        expect(openCopies().map((task) => task.id)).toEqual(['weekly']);
    });

    it('Stop repeating from that toast ends the series', async () => {
        seed([weekly], 'weekly');
        renderPanel([weekly]);
        await markDone();
        await playSequence();
        await act(async () => {
            lastToast()!.secondaryAction!.onClick();
            await vi.advanceTimersByTimeAsync(1);
        });
        expect(openCopies()).toHaveLength(0);
        expect(lastToast()!.message).toBe('Stopped repeating');
    });

    it('right after the last occurrence it asks first (no row to ask in, so in a toast)', async () => {
        const justDone: Task = { ...weekly, id: 'previous', status: 'done', completedAt: new Date().toISOString() };
        seed([justDone, weekly], 'weekly');
        renderPanel([weekly]);
        await markDone();
        expect(allTasks().find((task) => task.id === 'weekly')?.status).toBe('next');
        const ask = lastToast()!;
        expect(ask.message).toBe("This repeats. Mark next week's as done too?");
        await act(async () => {
            ask.action!.onClick();
            await vi.advanceTimersByTimeAsync(1);
        });
        expect(allTasks().find((task) => task.id === 'weekly')?.status).toBe('done');
    });

    it('a plain task shows no repeat toast', async () => {
        const plain: Task = { ...weekly, id: 'plain', recurrence: undefined };
        seed([plain], 'plain');
        renderPanel([plain]);
        await markDone();
        await playSequence();
        expect(allTasks().find((task) => task.id === 'plain')?.status).toBe('done');
        expect(useUiStore.getState().toasts).toHaveLength(0);
    });
});
