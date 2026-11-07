import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useTaskStore, type Task } from '@stride/core';
import { LanguageProvider } from '../../contexts/language-context';
import { useUiStore } from '../../store/ui-store';
import { OCCURRENCE_ARRIVAL_MS, resetCompletionRetentionForTests } from '../../lib/completion-retention';
import { COMPLETION_GONE_LINGER_MS, COMPLETION_TIMELINE, resetCompletionSequenceForTests } from '../../lib/completion-sequence';
import { MOTION_STORAGE_KEY, resetMotionPreferenceForTests } from '../../lib/motion';
import { resetRepeatTickGuardForTests } from '../../lib/repeating-completion';
import { AgendaView } from './AgendaView';

vi.mock('../../lib/report-error', () => ({ reportError: vi.fn() }));

const stamp = '2026-01-01T00:00:00.000Z';
const dayKey = (offset: number) => {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const makeTask = (id: string, extra: Partial<Task> = {}): Task => ({
    id, title: `Task ${id}`, status: 'next', tags: [], contexts: [], createdAt: stamp, updatedAt: stamp, ...extra,
});
const weekly = makeTask('weekly', { title: 'Call Brian', dueDate: dayKey(3), recurrence: { rule: 'weekly', strategy: 'fluid' } });
const plain = makeTask('plain', { startTime: dayKey(4), dueDate: dayKey(4) });

const renderAgenda = () => render(<LanguageProvider><AgendaView /></LanguageProvider>);
const rowIds = (container: HTMLElement) => [...new Set(
    Array.from(container.querySelectorAll('[data-task-id]')).map((element) => element.getAttribute('data-task-id')),
)];
const allTasks = () => useTaskStore.getState()._allTasks;
const nextOccurrence = () => allTasks().find((task) => task.id !== 'weekly' && task.recurrence && !task.deletedAt);
const toastMessages = () => useUiStore.getState().toasts.map((toast) => toast.message);
const lastToast = () => useUiStore.getState().toasts.slice(-1)[0];

async function tick(container: HTMLElement, id: string) {
    await act(async () => {
        fireEvent.click(container.querySelector(`[data-task-id="${id}"] [data-task-complete]`) as HTMLElement);
        await Promise.resolve();
    });
}
const advance = (ms: number) => act(async () => { vi.advanceTimersByTime(ms); });
/** To the moment the sequence has ended and the entry is gone too. */
const playSequence = async () => {
    await advance(COMPLETION_TIMELINE.gone + 1);
    await advance(COMPLETION_GONE_LINGER_MS + 1);
};

describe('AgendaView repeating tasks', () => {
    const initialUi = useUiStore.getState();
    beforeEach(() => {
        window.localStorage.clear();
        resetMotionPreferenceForTests();
        resetCompletionRetentionForTests();
        resetCompletionSequenceForTests();
        resetRepeatTickGuardForTests();
        useUiStore.setState(initialUi, true);
        useUiStore.setState({ toasts: [] });
        const tasks = [weekly, plain];
        useTaskStore.setState({
            tasks, _allTasks: tasks, projects: [], _allProjects: [], areas: [], _allAreas: [],
            settings: { deviceId: 'test-device' }, error: null, highlightTaskId: null, lastDataChangeAt: 0,
        });
    });
    afterEach(() => {
        resetCompletionSequenceForTests();
        resetCompletionRetentionForTests();
        resetRepeatTickGuardForTests();
        resetMotionPreferenceForTests();
        vi.useRealTimers();
    });

    it('holds the next occurrence back during the sequence, then shows it highlighted at its date', async () => {
        const view = renderAgenda();
        expect(rowIds(view.container)).toEqual(['weekly', 'plain']);

        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
        await tick(view.container, 'weekly');
        const occurrence = nextOccurrence();
        expect(occurrence).toBeDefined();

        // The store has both; the view still only has the card playing its sequence.
        expect(rowIds(view.container)).toEqual(['weekly', 'plain']);
        await advance(COMPLETION_TIMELINE.leaving + 1);
        expect(rowIds(view.container)).toEqual(['weekly', 'plain']);
        expect(toastMessages()).toEqual([]);

        await advance(COMPLETION_TIMELINE.gone - COMPLETION_TIMELINE.leaving);
        expect(rowIds(view.container)).toEqual(['plain', occurrence?.id]);
        const row = view.container.querySelector(`[data-task-id="${occurrence?.id}"]`);
        expect(row).toHaveAttribute('data-occurrence-arrived');
        expect(row?.textContent).toContain('Weekly');

        await advance(OCCURRENCE_ARRIVAL_MS + 1);
        expect(view.container.querySelector(`[data-task-id="${occurrence?.id}"]`)).not.toHaveAttribute('data-occurrence-arrived');
    });

    it('says when it repeats next once the sequence has played', async () => {
        const view = renderAgenda();
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
        await tick(view.container, 'weekly');
        expect(toastMessages()).toEqual([]);
        await advance(COMPLETION_TIMELINE.gone + 1);

        expect(toastMessages()).toEqual([expect.stringMatching(/^Done\. Repeats next on \w{3} \d{1,2} \w{3}$/)]);
        expect(lastToast()?.action?.label).toBe('Undo');
        expect(lastToast()?.secondaryAction?.label).toBe('Stop repeating');
    });

    it('takes the done copy out of the view for good, while it stays done in the data', async () => {
        const view = renderAgenda();
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
        await tick(view.container, 'weekly');
        await playSequence();
        expect(rowIds(view.container)).not.toContain('weekly');
        expect(allTasks().find((task) => task.id === 'weekly')?.status).toBe('done');
    });

    it('keeps a plain task at the bottom of its section', async () => {
        const focused = [
            makeTask('a', { isFocusedToday: true, focusOrder: 0 }),
            makeTask('b', { isFocusedToday: true, focusOrder: 1 }),
        ];
        useTaskStore.setState({ tasks: focused, _allTasks: focused });
        const view = renderAgenda();
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
        await tick(view.container, 'a');
        await playSequence();
        expect(rowIds(view.container)).toEqual(['b', 'a']);
        expect(toastMessages()).toEqual(['Task a marked Done']);
    });

    it('Undo puts the task back and removes the occurrence', async () => {
        const view = renderAgenda();
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
        await tick(view.container, 'weekly');
        await playSequence();
        const occurrenceId = nextOccurrence()?.id;

        await act(async () => {
            lastToast()?.action?.onClick();
            await advance(1);
        });
        await advance(1);
        expect(allTasks().find((task) => task.id === 'weekly')?.status).toBe('next');
        expect(allTasks().find((task) => task.id === occurrenceId)?.deletedAt).toBeTruthy();
        expect(rowIds(view.container)).toEqual(['weekly', 'plain']);
    });

    it('unticking during the sequence also removes the occurrence, so the series does not split', async () => {
        const view = renderAgenda();
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
        await tick(view.container, 'weekly');
        const occurrenceId = nextOccurrence()?.id;
        await advance(COMPLETION_TIMELINE.holding);
        await act(async () => {
            fireEvent.click(view.container.querySelector('[data-task-id="weekly"] [data-task-uncomplete]') as HTMLElement);
            await Promise.resolve();
        });
        await advance(1);
        expect(allTasks().find((task) => task.id === 'weekly')?.status).toBe('next');
        expect(allTasks().find((task) => task.id === occurrenceId)?.deletedAt).toBeTruthy();
        await playSequence();
        expect(rowIds(view.container)).toEqual(['weekly', 'plain']);
        expect(toastMessages()).toEqual([]);
    });

    it('Stop repeating takes the next occurrence out of the future, and Undo brings it back repeating', async () => {
        const view = renderAgenda();
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
        await tick(view.container, 'weekly');
        await playSequence();
        const occurrence = nextOccurrence();
        const occurrenceId = occurrence?.id as string;
        const stored = () => allTasks().find((task) => task.id === occurrenceId);

        await act(async () => {
            lastToast()?.secondaryAction?.onClick();
            await advance(1);
        });
        await advance(1);
        expect(stored()?.recurrence).toBeUndefined();
        expect(stored()?.deletedAt).toBeTruthy();
        expect(rowIds(view.container)).not.toContain(occurrenceId);
        expect(toastMessages()).toContain('Stopped repeating');

        await act(async () => {
            lastToast()?.action?.onClick();
            await advance(1);
        });
        await advance(1);
        expect(stored()?.deletedAt).toBeFalsy();
        expect(stored()?.recurrence).toEqual(occurrence?.recurrence);
        expect(rowIds(view.container)).toContain(occurrenceId);
    });

    it('Stop repeating from an older toast does not touch an occurrence completed since', async () => {
        const view = renderAgenda();
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
        await tick(view.container, 'weekly');
        await playSequence();
        const firstToast = lastToast();
        const second = nextOccurrence()?.id as string;
        await tick(view.container, second);
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
            await Promise.resolve();
        });
        await playSequence();
        const third = allTasks().find((task) => task.status === 'next' && task.recurrence)?.id as string;

        await act(async () => {
            firstToast?.secondaryAction?.onClick();
            await advance(1);
        });
        await advance(1);
        const stored = (id: string) => allTasks().find((task) => task.id === id);
        expect(stored(second)?.status).toBe('done');
        expect(stored(second)?.deletedAt).toBeFalsy();
        expect(stored(third)?.deletedAt).toBeTruthy();
    });

    describe('a second tick within a minute', () => {
        async function completeFirst() {
            const view = renderAgenda();
            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
            await tick(view.container, 'weekly');
            await playSequence();
            return { view, occurrenceId: nextOccurrence()?.id as string };
        }
        const stored = (id: string) => allTasks().find((task) => task.id === id);

        it('asks in the row and leaves the series alone on Cancel', async () => {
            const { view, occurrenceId } = await completeFirst();
            await tick(view.container, occurrenceId);
            expect(screen.getByTestId('repeat-tick-confirm').textContent).toContain("This repeats. Mark next week's as done too?");
            expect(stored(occurrenceId)?.status).toBe('next');

            await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); });
            expect(screen.queryByTestId('repeat-tick-confirm')).toBeNull();
            expect(stored(occurrenceId)?.status).toBe('next');
            expect(allTasks().filter((task) => task.status === 'done')).toHaveLength(1);
        });

        it('cancels with Escape', async () => {
            const { view, occurrenceId } = await completeFirst();
            await tick(view.container, occurrenceId);
            await act(async () => { fireEvent.keyDown(screen.getByTestId('repeat-tick-confirm'), { key: 'Escape' }); });
            expect(screen.queryByTestId('repeat-tick-confirm')).toBeNull();
            expect(stored(occurrenceId)?.status).toBe('next');
        });

        it('completes it on Yes, and the next one after that asks again', async () => {
            const { view, occurrenceId } = await completeFirst();
            await tick(view.container, occurrenceId);
            await act(async () => {
                fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
                await Promise.resolve();
            });
            expect(stored(occurrenceId)?.status).toBe('done');
            await playSequence();
            const third = allTasks().find((task) => task.status === 'next' && task.recurrence)?.id as string;
            await tick(view.container, third);
            expect(screen.getByTestId('repeat-tick-confirm')).toBeInTheDocument();
        });

        it('does not ask once the minute has passed', async () => {
            const { view, occurrenceId } = await completeFirst();
            await advance(61_000);
            await tick(view.container, occurrenceId);
            expect(screen.queryByTestId('repeat-tick-confirm')).toBeNull();
            expect(stored(occurrenceId)?.status).toBe('done');
        });

        it('drops an unanswered question', async () => {
            const { view, occurrenceId } = await completeFirst();
            await tick(view.container, occurrenceId);
            await advance(30_001);
            expect(screen.queryByTestId('repeat-tick-confirm')).toBeNull();
            expect(stored(occurrenceId)?.status).toBe('next');
        });
    });

    describe('with Animations off', () => {
        beforeEach(() => {
            window.localStorage.setItem(MOTION_STORAGE_KEY, 'off');
            resetMotionPreferenceForTests();
        });

        it('swaps the done copy for the next occurrence at once and still says when it repeats', async () => {
            const view = renderAgenda();
            await tick(view.container, 'weekly');
            const occurrenceId = nextOccurrence()?.id;
            expect(rowIds(view.container)).toEqual(['plain', occurrenceId]);
            expect(toastMessages()).toEqual([expect.stringMatching(/^Done\. Repeats next on /)]);
        });

        it('still asks before a second tick', async () => {
            const view = renderAgenda();
            await tick(view.container, 'weekly');
            await tick(view.container, nextOccurrence()?.id as string);
            expect(screen.getByTestId('repeat-tick-confirm')).toBeInTheDocument();
        });
    });

    it('keeps the message, without Undo, when undo notifications are off', async () => {
        useTaskStore.setState({ settings: { deviceId: 'test-device', undoNotificationsEnabled: false } });
        const view = renderAgenda();
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
        await tick(view.container, 'weekly');
        await advance(COMPLETION_TIMELINE.gone + 1);
        expect(toastMessages()).toEqual([expect.stringMatching(/^Done\. Repeats next on /)]);
        expect(lastToast()?.action?.label).toBe('Stop repeating');
        expect(lastToast()?.secondaryAction).toBeUndefined();
    });
});
