import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as panelWindow from '../lib/menubar-panel-window';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useTaskStore, type InboxProcessSuggestion, type Task } from '@stride/core';
import { LanguageProvider } from '../contexts/language-context';
import { MenuBarPanel, readStoredTab } from './MenuBarPanel';
import { resetCompletionRetentionForTests } from '../lib/completion-retention';
import { COMPLETION_TIMELINE, resetCompletionSequenceForTests } from '../lib/completion-sequence';
import { resetRepeatTickGuardForTests } from '../lib/repeating-completion';
import { usePomodoroStore } from '../store/pomodoro-store';

const sortService = vi.hoisted(() => ({
    generate: vi.fn(),
    apply: vi.fn(),
    undo: vi.fn(),
    remember: vi.fn(),
}));
vi.mock('../lib/inbox-process-service', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../lib/inbox-process-service')>()),
    generateInboxProcessing: sortService.generate,
    applyInboxProcessing: sortService.apply,
    undoInboxProcessing: sortService.undo,
    rememberInboxSuggestions: sortService.remember,
}));

const at = (offsetDays: number, hour = 12) => new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + offsetDays, hour).toISOString();
const makeTask = (id: string, extra: Partial<Task> = {}): Task => ({
    id, title: `Task ${id}`, status: 'next', tags: [], contexts: [],
    createdAt: at(-10), updatedAt: at(-10), ...extra,
});

const renderPanel = () => render(
    <LanguageProvider>
        <MenuBarPanel />
    </LanguageProvider>,
);
const rowTitles = () => screen.getAllByTestId('menubar-row').map((row) => row.querySelector('[data-row-main] span')?.textContent);
const suggestion = (taskId: string, extra: Partial<InboxProcessSuggestion> = {}): InboxProcessSuggestion => ({
    taskId, originalTitle: taskId, kind: 'next', title: taskId, needsYou: false, ...extra,
});

// Other tests swap store actions for mocks; the repeating tests need the real follow-up.
const { moveTask: realMoveTask, updateTask: realUpdateTask, deleteTask: realDeleteTask, restoreTask: realRestoreTask } = useTaskStore.getState();

describe('MenuBarPanel', () => {
    beforeEach(() => {
        window.localStorage.clear();
        sortService.generate.mockReset();
        sortService.apply.mockReset();
        sortService.undo.mockReset();
        sortService.remember.mockReset();
        const tasks = [
            makeTask('late', { title: 'Pay invoice', dueDate: at(-2) }),
            makeTask('today', { title: 'Call dentist', dueDate: at(0, 23) }),
            makeTask('later', { title: 'Plan trip' }),
        ];
        useTaskStore.setState({
            tasks, _allTasks: tasks, projects: [], areas: [], settings: {}, error: null,
            fetchData: vi.fn().mockResolvedValue(undefined),
        } as never);
    });

    it('has only two tabs, Now and All tasks, and no Add task, AI Capture or Assistant', () => {
        renderPanel();
        expect(screen.getAllByRole('tab').map((tab) => tab.textContent?.replace(/\d+$/, ''))).toEqual(['Now', 'All tasks']);
        expect(screen.getByRole('tab', { name: /Now/ })).toHaveAttribute('aria-selected', 'true');
        expect(screen.queryByRole('button', { name: /AI Capture/ })).toBeNull();
        expect(screen.queryByLabelText(/Ask the Assistant/)).toBeNull();
        expect(screen.queryByLabelText(/^Add task$/)).toBeNull();
        expect(screen.getByLabelText('Jot something down…')).toBeInTheDocument();
    });

    it('Now is one list for today: overdue, focus and due today, without section headers', () => {
        const tasks = [
            makeTask('late', { title: 'Pay invoice', dueDate: at(-2) }),
            makeTask('focus', { title: 'Send the reel edit', isFocusedToday: true }),
            makeTask('today', { title: 'Call dentist', dueDate: at(0, 23) }),
            makeTask('later', { title: 'Plan trip' }),
        ];
        useTaskStore.setState({ tasks, _allTasks: tasks } as never);
        renderPanel();
        expect(rowTitles()).toEqual(['Pay invoice', 'Send the reel edit', 'Call dentist']);
        expect(screen.queryByRole('heading', { name: /Overdue/ })).toBeNull();
        const late = screen.getAllByTestId('menubar-row')[0]!;
        expect(within(late).getByTestId('menubar-row-date')).toHaveTextContent(/^Overdue · /);
        expect(within(screen.getAllByTestId('menubar-row')[1]!).getByTestId('menubar-row-focus')).toHaveTextContent('Focus');
        expect(within(screen.getAllByTestId('menubar-row')[2]!).getByTestId('menubar-row-date')).toHaveTextContent(/^Today/);
    });

    it('counts open tasks on both tabs', () => {
        renderPanel();
        expect(screen.getByTestId('menubar-tab-count-now')).toHaveTextContent('2');
        expect(screen.getByTestId('menubar-tab-count-all')).toHaveTextContent('1');
    });

    it('switches tabs and remembers the last one', () => {
        renderPanel();
        fireEvent.click(screen.getByRole('tab', { name: /All tasks/ }));
        expect(screen.getByText('Plan trip')).toBeInTheDocument();
        expect(window.localStorage.getItem('stride-menubar-tab')).toBe('all');
        fireEvent.keyDown(screen.getByRole('tab', { name: /All tasks/ }), { key: 'ArrowLeft' });
        expect(screen.getByRole('tab', { name: /Now/ })).toHaveAttribute('aria-selected', 'true');
    });

    it('restores the stored tab, and opens on Now when the stored tab no longer exists', () => {
        window.localStorage.setItem('stride-menubar-tab', 'all');
        const view = renderPanel();
        expect(screen.getByRole('tab', { name: /All tasks/ })).toHaveAttribute('aria-selected', 'true');
        view.unmount();
        for (const legacy of ['today', 'upcoming', 'inbox', 'next', 'garbage']) {
            window.localStorage.setItem('stride-menubar-tab', legacy);
            expect(readStoredTab()).toBe('now');
        }
        renderPanel();
        expect(screen.getByRole('tab', { name: /Now/ })).toHaveAttribute('aria-selected', 'true');
    });

    it('All tasks groups Tomorrow / This week / Later / No date, priority first, with search', () => {
        const tasks = [
            makeTask('t1', { title: 'Post two reels', dueDate: at(1, 10) }),
            makeTask('t2', { title: 'Holiday poster', dueDate: at(1, 15), priority: 'urgent' }),
            makeTask('w', { title: 'Visit the bank', dueDate: at(4) }),
            makeTask('l', { title: 'Renew passport', dueDate: at(30) }),
            makeTask('n', { title: 'Fix the washing machine', contexts: ['@home'] }),
            makeTask('s', { title: 'Learn Spanish', status: 'someday' }),
            makeTask('in', { title: 'Inbox note', status: 'inbox' }),
            makeTask('today', { title: 'Due today', dueDate: at(0, 23) }),
        ];
        useTaskStore.setState({ tasks, _allTasks: tasks } as never);
        renderPanel();
        fireEvent.click(screen.getByRole('tab', { name: /All tasks/ }));
        expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Tomorrow2', 'This week1', 'Later1', 'No date2']);
        expect(within(screen.getByTestId('menubar-group-tomorrow')).getAllByTestId('menubar-row').map((r) => r.getAttribute('data-task-id'))).toEqual(['t2', 't1']);
        expect(screen.queryByText('Inbox note')).toBeNull();
        expect(screen.queryByText('Due today')).toBeNull();
        expect(within(screen.getByTestId('menubar-group-none')).getByText('@home')).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Search tasks'), { target: { value: 'wash' } });
        expect(rowTitles()).toEqual(['Fix the washing machine']);
        fireEvent.change(screen.getByLabelText('Search tasks'), { target: { value: 'zzz' } });
        expect(screen.getByTestId('menubar-panel-empty')).toHaveTextContent('No matches');
    });

    it('＋ adds a task to Now (today\'s focus); a future start is cleared so it shows today', async () => {
        const tasks = [makeTask('soon', { title: 'Book flights', startTime: at(3, 9) })];
        const updateTask = vi.fn(async (id: string, patch: Partial<Task>) => {
            const next = useTaskStore.getState().tasks.map((task) => (task.id === id ? { ...task, ...patch } : task));
            useTaskStore.setState({ tasks: next, _allTasks: next } as never);
            return { success: true };
        });
        useTaskStore.setState({ tasks, _allTasks: tasks, updateTask } as never);
        renderPanel();
        fireEvent.click(screen.getByRole('tab', { name: /All tasks/ }));
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add to Now: Book flights' })); });
        expect(updateTask).toHaveBeenCalledWith('soon', { isFocusedToday: true, startTime: undefined });
        expect(screen.getByTestId('menubar-tab-count-now')).toHaveTextContent('1');
        fireEvent.click(screen.getByRole('tab', { name: /Now/ }));
        expect(rowTitles()).toEqual(['Book flights']);
    });

    it('▶ on a Now row starts a focus session on that task; ▶ in All tasks adds it to Now first', async () => {
        const tasks = [makeTask('today', { title: 'Call dentist', dueDate: at(0, 23) }), makeTask('later', { title: 'Plan trip' })];
        const updateTask = vi.fn().mockResolvedValue({ success: true });
        useTaskStore.setState({ tasks, _allTasks: tasks, settings: { features: { pomodoro: true } }, updateTask } as never);
        const notify = vi.spyOn(panelWindow, 'notifyMainWindow').mockResolvedValue(undefined);
        renderPanel();
        fireEvent.click(screen.getByRole('button', { name: 'Start a focus timer: Call dentist' }));
        let snapshot = usePomodoroStore.getState().snapshot;
        expect(snapshot.selectedTaskId).toBe('today');
        expect(snapshot.timerState).toMatchObject({ phase: 'focus', isRunning: true });
        expect(screen.getByTestId('panel-pomodoro')).toHaveAttribute('data-running', 'true');
        void notify;

        fireEvent.click(screen.getByRole('tab', { name: /All tasks/ }));
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Start a focus timer: Plan trip' })); });
        expect(updateTask).toHaveBeenCalledWith('later', { isFocusedToday: true });
        snapshot = usePomodoroStore.getState().snapshot;
        expect(snapshot.selectedTaskId).toBe('later');
    });

    it('hides ▶ when the Pomodoro feature is off', () => {
        useTaskStore.setState({ settings: { features: { pomodoro: false } } } as never);
        renderPanel();
        expect(screen.queryByTestId('menubar-row-start')).toBeNull();
        expect(screen.queryByTestId('panel-pomodoro')).toBeNull();
    });

    it('the note box saves straight to the Inbox on Enter, one item per line, without AI', async () => {
        const addTask = vi.fn().mockResolvedValue({ success: true, id: 'new' });
        useTaskStore.setState({ addTask } as never);
        renderPanel();
        const box = screen.getByLabelText('Jot something down…');
        fireEvent.change(box, { target: { value: 'Buy milk\nCall Rhea' } });
        await act(async () => { fireEvent.keyDown(box, { key: 'Enter' }); });
        expect(addTask).toHaveBeenCalledTimes(2);
        expect(addTask.mock.calls.map(([title, props]) => [title, props.status])).toEqual([['Buy milk', 'inbox'], ['Call Rhea', 'inbox']]);
        expect(sortService.generate).not.toHaveBeenCalled();
        expect(box).toHaveValue('');
    });

    it('shows the Inbox chip only when the Inbox has items, and ✨ Sort only when AI is on', () => {
        const view = renderPanel();
        expect(screen.queryByTestId('menubar-inbox-chip')).toBeNull();
        view.unmount();
        const tasks = [makeTask('a', { status: 'inbox' }), makeTask('b', { status: 'inbox' })];
        useTaskStore.setState({ tasks, _allTasks: tasks } as never);
        const second = renderPanel();
        expect(screen.getByTestId('menubar-inbox-chip')).toHaveTextContent('2 notes in Inbox');
        expect(screen.getByRole('button', { name: 'Review in Stride' })).toBeInTheDocument();
        expect(screen.queryByTestId('menubar-inbox-sort')).toBeNull();
        second.unmount();
        useTaskStore.setState({ settings: { ai: { enabled: true } } } as never);
        renderPanel();
        expect(screen.getByTestId('menubar-inbox-sort')).toHaveTextContent('Sort');
    });

    it('✨ Sort applies only the confident suggestions as one undoable batch and leaves the rest', async () => {
        const tasks = [makeTask('a', { status: 'inbox' }), makeTask('b', { status: 'inbox' }), makeTask('c', { status: 'inbox' }), makeTask('d', { status: 'inbox' })];
        useTaskStore.setState({ tasks, _allTasks: tasks, settings: { ai: { enabled: true } } } as never);
        sortService.generate.mockResolvedValue({
            status: 'ok',
            proposal: {
                summary: '', skippedTaskIds: [], source: 'ai',
                items: [
                    suggestion('a'),
                    suggestion('b', { needsYou: true, needsYouReason: 'low-confidence' }),
                    suggestion('c', { newProjectTitle: 'Brand new' }),
                    suggestion('d', { kind: 'delete', duplicateOf: 'a' }),
                ],
            },
        });
        sortService.apply.mockResolvedValue({ updatedTaskIds: ['a'], deletedTaskIds: [], createdProjectIds: [], createdAreaIds: [], failed: [], undoOps: [], changes: [], changeId: 'chg-1' });
        sortService.undo.mockResolvedValue(true);
        renderPanel();
        await act(async () => { fireEvent.click(screen.getByTestId('menubar-inbox-sort')); });
        expect(sortService.apply).toHaveBeenCalledTimes(1);
        expect(sortService.apply.mock.calls[0]![0].map((item: InboxProcessSuggestion) => item.taskId)).toEqual(['a']);
        expect(sortService.remember.mock.calls[0]![0].map((item: InboxProcessSuggestion) => item.taskId)).toEqual(['b', 'c', 'd']);
        const result = screen.getByTestId('menubar-sort-result');
        expect(result).toHaveTextContent('Sorted 1');
        expect(result).toHaveTextContent('3 need you');
        await act(async () => { fireEvent.click(screen.getByTestId('menubar-sort-undo')); });
        expect(sortService.undo).toHaveBeenCalledWith('chg-1');
        expect(screen.queryByTestId('menubar-sort-result')).toBeNull();
    });

    it('✨ Sort reports the usage limit instead of sorting', async () => {
        const tasks = [makeTask('a', { status: 'inbox' })];
        useTaskStore.setState({ tasks, _allTasks: tasks, settings: { ai: { enabled: true } } } as never);
        sortService.generate.mockResolvedValue({ status: 'unavailable', reason: 'limited' });
        renderPanel();
        await act(async () => { fireEvent.click(screen.getByTestId('menubar-inbox-sort')); });
        expect(sortService.apply).not.toHaveBeenCalled();
        expect(screen.getByTestId('menubar-sort-notice')).toHaveTextContent('AI limit reached');
    });

    it('completes a task through the store and offers undo', async () => {
        const moveTask = vi.fn().mockResolvedValue({ success: true });
        useTaskStore.setState({ moveTask } as never);
        renderPanel();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Mark done: Pay invoice/ }));
        });
        await waitFor(() => expect(moveTask).toHaveBeenCalledWith('late', 'done'));
        await waitFor(() => expect(screen.getAllByRole('status').some((node) => node.textContent?.includes('Pay invoice'))).toBe(true));
    });

    describe('repeating tasks', () => {
        const repeating = { rule: 'weekly' as const, strategy: 'fluid' as const };
        const weekly = () => makeTask('weekly', { title: 'Water plants', dueDate: at(2), recurrence: repeating });
        const seed = (tasks: Task[]) => useTaskStore.setState({
            tasks, _allTasks: tasks, _tasksById: new Map(tasks.map((task) => [task.id, task])),
            moveTask: realMoveTask, updateTask: realUpdateTask, deleteTask: realDeleteTask, restoreTask: realRestoreTask,
        } as never);
        const stored = () => useTaskStore.getState()._allTasks;
        const occurrence = () => stored().find((task) => task.id !== 'weekly' && task.recurrence && !task.deletedAt);
        const rowIds = () => screen.queryAllByTestId('menubar-row').map((row) => row.getAttribute('data-task-id'));
        const advance = (ms: number) => act(async () => { vi.advanceTimersByTime(ms); });
        const tick = (name: string | RegExp) => act(async () => {
            fireEvent.click(screen.getByRole('button', { name }));
            await Promise.resolve();
        });

        beforeEach(() => {
            resetCompletionRetentionForTests();
            resetCompletionSequenceForTests();
            resetRepeatTickGuardForTests();
            window.localStorage.setItem('stride-menubar-tab', 'all');
        });
        afterEach(() => {
            resetCompletionSequenceForTests();
            resetCompletionRetentionForTests();
            resetRepeatTickGuardForTests();
            vi.useRealTimers();
        });

        it('shows how a task repeats in the row', () => {
            seed([weekly(), makeTask('plain')]);
            renderPanel();
            expect(within(screen.getAllByTestId('menubar-row').find((row) => row.getAttribute('data-task-id') === 'weekly')!)
                .getByTestId('menubar-row-repeat')).toHaveTextContent('Weekly · after completion');
            expect(within(screen.getAllByTestId('menubar-row').find((row) => row.getAttribute('data-task-id') === 'plain')!)
                .queryByTestId('menubar-row-repeat')).toBeNull();
        });

        it('holds the next occurrence back, drops the done row after the sequence and says when it repeats', async () => {
            seed([weekly()]);
            renderPanel();
            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
            await tick(/Mark done: Water plants/);
            expect(occurrence()).toBeDefined();
            expect(rowIds()).toEqual(['weekly']);
            expect(screen.queryByTestId('menubar-completion-undo')).toBeNull();

            await advance(COMPLETION_TIMELINE.gone + 1);
            expect(rowIds()).toEqual([occurrence()?.id]);
            expect(screen.getByTestId('menubar-row')).toHaveAttribute('data-occurrence-arrived');
            expect(screen.getByTestId('menubar-completion-undo')).toHaveTextContent(/Done\. Repeats next on \w{3} \d{1,2} \w{3}/);
            expect(stored().find((task) => task.id === 'weekly')?.status).toBe('done');
        });

        it('Undo brings the task back and removes the occurrence', async () => {
            seed([weekly()]);
            renderPanel();
            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
            await tick(/Mark done: Water plants/);
            await advance(COMPLETION_TIMELINE.gone + 1);
            await act(async () => {
                fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
                await advance(1);
            });
            await advance(1);
            expect(stored().find((task) => task.id === 'weekly')?.status).toBe('next');
            expect(occurrence()).toBeUndefined();
            expect(rowIds()).toEqual(['weekly']);
        });

        it('Stop repeating ends the series, and Undo puts the occurrence back', async () => {
            seed([weekly()]);
            renderPanel();
            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
            await tick(/Mark done: Water plants/);
            await advance(COMPLETION_TIMELINE.gone + 1);
            const id = occurrence()?.id as string;

            await act(async () => {
                fireEvent.click(screen.getByRole('button', { name: 'Stop repeating' }));
                await advance(1);
            });
            await advance(1);
            expect(rowIds()).toEqual([]);
            expect(stored().find((task) => task.id === id)?.recurrence).toBeUndefined();
            expect(screen.getByTestId('menubar-completion-undo')).toHaveTextContent('Stopped repeating');

            await act(async () => {
                fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
                await advance(1);
            });
            await advance(1);
            expect(rowIds()).toEqual([id]);
            expect(stored().find((task) => task.id === id)?.recurrence).toMatchObject({ rule: 'weekly' });
        });

        describe('when the main window completed the previous occurrence moments ago', () => {
            const seedCompletedElsewhere = () => {
                const completedAt = new Date().toISOString();
                seed([
                    makeTask('previous', { title: 'Water plants', status: 'done', completedAt, recurrence: repeating }),
                    makeTask('current', {
                        title: 'Water plants', dueDate: at(2), createdAt: completedAt, updatedAt: completedAt,
                        recurrence: { ...repeating, seriesId: 'previous' },
                    }),
                ]);
            };
            const status = () => stored().find((task) => task.id === 'current')?.status;

            it('asks in the row, and Cancel leaves it open', async () => {
                seedCompletedElsewhere();
                renderPanel();
                await tick(/Mark done: Water plants/);
                expect(screen.getByTestId('repeat-tick-confirm')).toHaveTextContent("This repeats. Mark next week's as done too?");
                expect(status()).toBe('next');
                await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); });
                expect(screen.queryByTestId('repeat-tick-confirm')).toBeNull();
                expect(status()).toBe('next');
            });

            it('completes it on Yes', async () => {
                seedCompletedElsewhere();
                renderPanel();
                await tick(/Mark done: Water plants/);
                await tick('Yes');
                expect(status()).toBe('done');
            });

            it('uses the same check from the keyboard', async () => {
                seedCompletedElsewhere();
                renderPanel();
                const row = screen.getAllByTestId('menubar-row')[0]!.querySelector('[data-row-main]') as HTMLElement;
                await act(async () => { fireEvent.keyDown(row, { key: ' ' }); });
                expect(screen.getByTestId('repeat-tick-confirm')).toBeInTheDocument();
                expect(status()).toBe('next');
            });
        });
    });

    it('completes from All tasks too', async () => {
        const moveTask = vi.fn().mockResolvedValue({ success: true });
        useTaskStore.setState({ moveTask } as never);
        renderPanel();
        fireEvent.click(screen.getByRole('tab', { name: /All tasks/ }));
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Mark done: Plan trip/ })); });
        await waitFor(() => expect(moveTask).toHaveBeenCalledWith('later', 'done'));
    });

    it('keeps a ticked row on screen through its completion sequence, then moves it to the bottom', async () => {
        resetCompletionRetentionForTests();
        resetCompletionSequenceForTests();
        const moveTask = vi.fn(async (id: string, status: Task['status']) => {
            const next = useTaskStore.getState().tasks.map((task) => (task.id === id ? { ...task, status } : task));
            useTaskStore.setState({ tasks: next, _allTasks: next } as never);
            return { success: true };
        });
        useTaskStore.setState({ moveTask } as never);
        renderPanel();
        const order = () => screen.getAllByTestId('menubar-row').map((row) => row.getAttribute('data-task-id'));
        const first = order()[0]!;
        const title = useTaskStore.getState().tasks.find((task) => task.id === first)!.title;
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
        try {
            await act(async () => {
                fireEvent.click(screen.getByRole('button', { name: `Mark done: ${title}` }));
                // A fast second click is ignored (no double completion, no untick).
                fireEvent.click(screen.getAllByTestId('menubar-row')[0]!.querySelector('button')!);
                await Promise.resolve();
            });
            expect(moveTask).toHaveBeenCalledTimes(1);
            expect(order()[0]).toBe(first);
            const row = () => screen.getAllByTestId('menubar-row').find((element) => element.getAttribute('data-task-id') === first);
            expect(row()).toHaveAttribute('data-completion', 'popping');
            await act(async () => { vi.advanceTimersByTime(COMPLETION_TIMELINE.leaving + 10); });
            expect(row()).toHaveAttribute('data-completion', 'leaving');
            expect(order()[0]).toBe(first);
            await act(async () => { vi.advanceTimersByTime(COMPLETION_TIMELINE.gone - COMPLETION_TIMELINE.leaving); });
            expect(order()[order().length - 1]).toBe(first);
            expect(row()?.querySelector('[data-task-title-struck]')).not.toBeNull();
        } finally {
            resetCompletionSequenceForTests();
            vi.useRealTimers();
        }
    });

    it('shows a friendly empty state on each tab', () => {
        useTaskStore.setState({ tasks: [], _allTasks: [] } as never);
        renderPanel();
        expect(screen.getByTestId('menubar-panel-empty')).toHaveTextContent(/Nothing for today yet/);
        fireEvent.click(screen.getByRole('tab', { name: /All tasks/ }));
        expect(screen.getByTestId('menubar-panel-empty')).toHaveTextContent(/Nothing else on your list/);
    });

    it('"Review in Stride" opens the main window on the Inbox', async () => {
        const open = vi.spyOn(panelWindow, 'openMainFromMenuBarPanel').mockResolvedValue(undefined);
        const notify = vi.spyOn(panelWindow, 'notifyMainWindow').mockResolvedValue(undefined);
        const runtime = await import('../lib/runtime');
        const tasks = [makeTask('a', { status: 'inbox' })];
        useTaskStore.setState({ tasks, _allTasks: tasks } as never);
        renderPanel();
        // Only the click runs "in the app" (mounting would try to listen for native events).
        const tauri = vi.spyOn(runtime, 'isTauriRuntime').mockReturnValue(true);
        try {
            await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Review in Stride' })); });
            expect(open).toHaveBeenCalledWith();
            await waitFor(() => expect(notify).toHaveBeenCalledWith(panelWindow.MENUBAR_NAVIGATE_EVENT, { view: 'inbox' }));
        } finally {
            tauri.mockRestore();
        }
    });

    describe('reordering (Now)', () => {
        const setup = (tasks: Task[]) => {
            const reorderBoardTasks = vi.fn().mockResolvedValue(undefined);
            const reorderFocusedTasks = vi.fn().mockResolvedValue({ success: true });
            useTaskStore.setState({ tasks, _allTasks: tasks, reorderBoardTasks, reorderFocusedTasks } as never);
            vi.spyOn(panelWindow, 'notifyMainWindow').mockResolvedValue(undefined);
            return { reorderBoardTasks, reorderFocusedTasks };
        };
        const dueToday = () => [
            makeTask('d1', { title: 'First thing', dueDate: at(0, 20), boardOrder: 1000 }),
            makeTask('d2', { title: 'Second thing', dueDate: at(0, 21), boardOrder: 2000 }),
            makeTask('d3', { title: 'Third thing', dueDate: at(0, 22), boardOrder: 3000 }),
        ];
        const manualKey = (key: string) => `stride:view:manual-order:${key}:v1`;

        it('persists reorders of focused rows through the Focus order', async () => {
            const tasks = [
                makeTask('f1', { title: 'Focus one', isFocusedToday: true, focusOrder: 1000 }),
                makeTask('f2', { title: 'Focus two', isFocusedToday: true, focusOrder: 2000 }),
                makeTask('plain', { title: 'Just due', dueDate: at(0, 23) }),
            ];
            const { reorderFocusedTasks } = setup(tasks);
            renderPanel();
            expect(rowTitles()).toEqual(['Focus one', 'Focus two', 'Just due']);
            const first = screen.getAllByTestId('menubar-row')[0]!.querySelector('[data-row-main]') as HTMLElement;
            await act(async () => {
                fireEvent.keyDown(first, { key: 'ArrowDown', altKey: true });
            });
            expect(reorderFocusedTasks).toHaveBeenCalledWith(['f2', 'f1']);
        });

        it('lets the other rows move within their run through the board order, switching Today to manual order with Undo', async () => {
            const tasks = [
                makeTask('f1', { title: 'Focus one', isFocusedToday: true, focusOrder: 0 }),
                makeTask('early', { title: 'Due early', dueDate: at(0, 20) }),
                makeTask('late', { title: 'Due late', dueDate: at(0, 23) }),
                makeTask('over', { title: 'Overdue', dueDate: at(-1) }),
            ];
            const { reorderBoardTasks, reorderFocusedTasks } = setup(tasks);
            renderPanel();
            expect(rowTitles()).toEqual(['Overdue', 'Focus one', 'Due early', 'Due late']);
            const lateRow = screen.getAllByTestId('menubar-row').find((row) => row.textContent?.includes('Due late'))!;
            expect(lateRow).toHaveAttribute('data-reorder-group', 'today:today');
            const overdueRow = screen.getAllByTestId('menubar-row').find((row) => row.textContent?.includes('Overdue'))!;
            expect(overdueRow).toHaveAttribute('data-reorder-group', 'today:overdue');
            await act(async () => {
                fireEvent.keyDown(lateRow.querySelector('[data-row-main]')!, { key: 'ArrowUp', altKey: true });
            });
            expect(reorderBoardTasks).toHaveBeenCalledWith('next', ['late', 'early'], 'late');
            expect(reorderFocusedTasks).not.toHaveBeenCalled();
            expect(window.localStorage.getItem(manualKey('focus-today'))).toBe('1');
            expect(screen.getByTestId('menubar-manual-order-undo')).toHaveTextContent('Switched to manual order');
            await act(async () => {
                fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
            });
            expect(window.localStorage.getItem(manualKey('focus-today'))).toBeNull();
        });

        it('moves a row down with Alt+ArrowDown and announces its position', async () => {
            window.localStorage.setItem(manualKey('focus-today'), '1');
            const { reorderBoardTasks } = setup(dueToday());
            renderPanel();
            const first = screen.getAllByTestId('menubar-row')[0]!.querySelector('[data-row-main]') as HTMLElement;
            await act(async () => {
                fireEvent.keyDown(first, { key: 'ArrowDown', altKey: true });
            });
            expect(reorderBoardTasks).toHaveBeenCalledWith('next', ['d2', 'd1', 'd3'], 'd1');
            await waitFor(() => expect(screen.getByTestId('menubar-reorder-announcement')).toHaveTextContent('Moved down, position 2 of 3'));
        });

        it('does nothing for Alt+ArrowUp on the first row', async () => {
            const { reorderBoardTasks } = setup(dueToday());
            renderPanel();
            const first = screen.getAllByTestId('menubar-row')[0]!.querySelector('[data-row-main]') as HTMLElement;
            await act(async () => {
                fireEvent.keyDown(first, { key: 'ArrowUp', altKey: true });
            });
            expect(reorderBoardTasks).not.toHaveBeenCalled();
        });

        it('moves a row to the top from its actions menu', async () => {
            window.localStorage.setItem(manualKey('focus-today'), '1');
            const { reorderBoardTasks } = setup(dueToday());
            renderPanel();
            fireEvent.click(screen.getByRole('button', { name: /More actions: Third thing/ }));
            expect(screen.getByRole('menuitem', { name: 'Move down' })).toBeDisabled();
            await act(async () => {
                fireEvent.click(screen.getByRole('menuitem', { name: 'Move to top' }));
            });
            expect(reorderBoardTasks).toHaveBeenCalledWith('next', ['d3', 'd1', 'd2'], 'd3');
            await waitFor(() => expect(screen.getByTestId('menubar-reorder-announcement')).toHaveTextContent('Moved to top, position 1 of 3'));
        });

        it('opens the same menu from a right click', () => {
            setup(dueToday());
            renderPanel();
            fireEvent.contextMenu(screen.getAllByTestId('menubar-row')[1]!);
            expect(screen.getByRole('menu')).toBeInTheDocument();
            expect(screen.getByRole('menuitem', { name: 'Move up' })).toBeEnabled();
        });

        it('All tasks rows are not reorderable (they follow date and priority)', () => {
            setup([makeTask('n1', { title: 'No date one' }), makeTask('n2', { title: 'No date two' })]);
            renderPanel();
            fireEvent.click(screen.getByRole('tab', { name: /All tasks/ }));
            screen.getAllByTestId('menubar-row').forEach((row) => expect(row).not.toHaveAttribute('data-reorder-id'));
        });

        it('re-reads the data file when the panel regains focus and shows the new order', async () => {
            window.localStorage.setItem(manualKey('focus-today'), '1');
            const tasks = dueToday();
            const reordered = [{ ...tasks[0]!, boardOrder: 3500 }, tasks[1]!, tasks[2]!];
            let mainWindowReordered = false;
            const fetchData = vi.fn().mockImplementation(async () => {
                if (mainWindowReordered) useTaskStore.setState({ tasks: reordered, _allTasks: reordered } as never);
            });
            setup(tasks);
            useTaskStore.setState({ fetchData } as never);
            renderPanel();
            expect(rowTitles()).toEqual(['First thing', 'Second thing', 'Third thing']);
            mainWindowReordered = true;
            await act(async () => {
                window.dispatchEvent(new Event('focus'));
            });
            await waitFor(() => expect(rowTitles()).toEqual(['Second thing', 'Third thing', 'First thing']));
        });

        describe('dragging', () => {
            const rect = (top: number) => ({ top, bottom: top + 40, left: 0, right: 300, width: 300, height: 40, x: 0, y: top, toJSON: () => ({}) });
            const pointer = (type: string, y: number, target: Element | Document) => {
                const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 20, clientY: y, button: 0 });
                Object.defineProperties(event, { pointerId: { value: 1 }, isPrimary: { value: true } });
                act(() => { target.dispatchEvent(event); });
            };
            const setupDrag = () => {
                window.localStorage.setItem(manualKey('focus-today'), '1');
                const result = setup(dueToday());
                renderPanel();
                const rows = screen.getAllByTestId('menubar-row');
                rows.forEach((row, index) => { row.getBoundingClientRect = () => rect(index * 44) as DOMRect; });
                return { ...result, rows };
            };

            it('drops a dragged row at the line and saves the new order', async () => {
                const { rows, reorderBoardTasks } = setupDrag();
                pointer('pointerdown', 20, rows[0]!.querySelector('[data-row-main]')!);
                pointer('pointermove', 30, document);
                pointer('pointermove', 90, document);
                expect(rows[0]).toHaveAttribute('data-dragging', 'true');
                expect(screen.getByTestId('menubar-drag-ghost')).toBeInTheDocument();
                expect(rows[2]!.querySelector('[data-testid="menubar-drop-line"]')).toHaveAttribute('data-placement', 'before');
                await act(async () => { pointer('pointerup', 90, document); });
                expect(reorderBoardTasks).toHaveBeenCalledWith('next', ['d2', 'd1', 'd3'], 'd1');
                expect(screen.queryByTestId('menubar-drag-ghost')).toBeNull();
            });

            it('treats a press without travel as a normal click, not a drag', () => {
                const { rows, reorderBoardTasks } = setupDrag();
                pointer('pointerdown', 20, rows[0]!.querySelector('[data-row-main]')!);
                pointer('pointermove', 21, document);
                pointer('pointerup', 21, document);
                expect(screen.queryByTestId('menubar-drag-ghost')).toBeNull();
                expect(reorderBoardTasks).not.toHaveBeenCalled();
            });

            it('cancels the drag on Escape without hiding the panel or saving', () => {
                const { rows, reorderBoardTasks } = setupDrag();
                pointer('pointerdown', 20, rows[0]!.querySelector('[data-row-main]')!);
                pointer('pointermove', 90, document);
                const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
                act(() => { document.dispatchEvent(escape); });
                expect(escape.defaultPrevented).toBe(true);
                expect(screen.queryByTestId('menubar-drag-ghost')).toBeNull();
                pointer('pointerup', 90, document);
                expect(reorderBoardTasks).not.toHaveBeenCalled();
            });

            it('does not start a drag from the complete checkbox', () => {
                const { rows } = setupDrag();
                pointer('pointerdown', 20, screen.getByRole('button', { name: /Mark done: First thing/ }));
                pointer('pointermove', 90, document);
                expect(rows[0]).not.toHaveAttribute('data-dragging');
            });
        });
    });
});
