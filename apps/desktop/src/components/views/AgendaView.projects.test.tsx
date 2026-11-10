import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { useTaskStore, type Area, type Project, type Task } from '@stride/core';
import { LanguageProvider } from '../../contexts/language-context';
import { LIST_OPTIONS_STORAGE_KEY, useUiStore } from '../../store/ui-store';
import { resetCompletionRetentionForTests } from '../../lib/completion-retention';
import { COMPLETION_TIMELINE, resetCompletionSequenceForTests } from '../../lib/completion-sequence';
import { MANUAL_ORDER_KEYS, readManualOrder, writeManualOrder } from '../../lib/manual-order';
import { AgendaView } from './AgendaView';

vi.mock('../../lib/report-error', () => ({ reportError: vi.fn() }));

const nowIso = '2026-11-08T09:00:00.000Z';
const STORAGE_KEY = 'stride:view:focus:v1';

const makeTask = (id: string, overrides: Partial<Task> = {}): Task => ({
    id, title: `Task ${id}`, status: 'next', tags: [], contexts: [],
    createdAt: nowIso, updatedAt: nowIso, ...overrides,
});
const makeProject = (id: string, order: number, overrides: Partial<Project> = {}): Project => ({
    id, title: `Project ${id}`, status: 'active', color: '#2563eb', order, tagIds: [],
    createdAt: nowIso, updatedAt: nowIso, ...overrides,
} as Project);

const seed = (tasks: Task[], projects: Project[], areas: Area[] = []) => useTaskStore.setState({
    tasks, _allTasks: tasks, projects, _allProjects: projects, areas, _allAreas: areas,
    settings: { deviceId: 'test-device' }, error: null, highlightTaskId: null, lastDataChangeAt: 0,
});

const renderAgenda = () => render(<LanguageProvider><AgendaView /></LanguageProvider>);
const card = (container: HTMLElement, projectId: string) => (
    container.querySelector<HTMLElement>(`[data-testid="focus-project-card"][data-project-id="${projectId}"]`)
);
const rowIds = (element: Element | null) => Array.from(element?.querySelectorAll('[data-task-id]') ?? [])
    .map((row) => row.getAttribute('data-task-id'));
const transfer = () => ({ setData: vi.fn(), getData: vi.fn(), setDragImage: vi.fn(), effectAllowed: 'move', dropEffect: 'move', types: [] });

describe('Focus Projects layout', () => {
    const initialUi = useUiStore.getState();
    beforeEach(() => {
        window.localStorage.clear();
        resetCompletionRetentionForTests();
        resetCompletionSequenceForTests();
        useUiStore.setState(initialUi, true);
        useUiStore.setState({ listOptions: { ...initialUi.listOptions, focusLayout: 'projects', focusGroupBy: 'none' } });
        useUiStore.setState({ toasts: [] } as never);
    });
    afterEach(() => {
        resetCompletionSequenceForTests();
        vi.useRealTimers();
    });

    const aircraft = (count: number): Task[] => Array.from({ length: count }, (_, index) => (
        makeTask(`a${index}`, { projectId: 'aircraft', order: index })
    ));

    it('shows one card per project with only the next action, the progress, and loose tasks after', () => {
        seed([
            ...aircraft(3),
            makeTask('a-done', { projectId: 'aircraft', status: 'done' }),
            makeTask('b0', { projectId: 'bank', order: 0 }),
            makeTask('loose-1'),
        ], [makeProject('aircraft', 0, { title: 'Build the aircraft' }), makeProject('bank', 1, { title: 'Open bank account' })]);
        const { container, getByText, getByRole, queryByText } = renderAgenda();

        const aircraftCard = card(container, 'aircraft');
        expect(rowIds(aircraftCard)).toEqual(['a0']);
        expect(getByRole('group', { name: 'Build the aircraft, 1 of 4' })).toBe(aircraftCard);
        expect(aircraftCard?.textContent).toContain('1 of 4');
        expect(rowIds(card(container, 'bank'))).toEqual(['b0']);
        expect(getByText('Task loose-1')).toBeInTheDocument();
        expect(getByText('(2 projects · 1 task)')).toBeInTheDocument();
        expect(queryByText('No grouping')).toBeNull();
    });

    it('expands a card in place, labels the chevron, and remembers it per project', () => {
        seed(aircraft(3), [makeProject('aircraft', 0)]);
        const view = renderAgenda();
        const chevron = view.getByRole('button', { name: /Show other next actions: Project aircraft/ });
        expect(chevron).toHaveAttribute('aria-expanded', 'false');
        expect(chevron.getAttribute('aria-controls')).toBe('focus-project-card-aircraft');

        fireEvent.click(chevron);
        expect(rowIds(card(view.container, 'aircraft'))).toEqual(['a0', 'a1', 'a2']);
        expect(document.getElementById('focus-project-card-aircraft')).toBeInTheDocument();

        view.unmount();
        const reopened = renderAgenda();
        expect(rowIds(card(reopened.container, 'aircraft'))).toEqual(['a0', 'a1', 'a2']);
    });

    it('opens the project from the header', () => {
        const navigated = vi.fn();
        window.addEventListener('stride:navigate', navigated);
        seed(aircraft(2), [makeProject('aircraft', 0)]);
        const { getByRole } = renderAgenda();
        fireEvent.click(getByRole('button', { name: /^Open Project aircraft$/ }));
        expect(useUiStore.getState().projectView.selectedProjectId).toBe('aircraft');
        window.removeEventListener('stride:navigate', navigated);
    });

    it('plays the completion sequence on the next action, then the next task rises into the card', async () => {
        seed(aircraft(2), [makeProject('aircraft', 0)]);
        const { container } = renderAgenda();
        expect(rowIds(card(container, 'aircraft'))).toEqual(['a0']);

        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
        const tick = card(container, 'aircraft')?.querySelector('[data-task-id="a0"] [data-task-complete]') as HTMLElement;
        await act(async () => {
            fireEvent.click(tick);
            await Promise.resolve();
        });
        expect(useTaskStore.getState()._allTasks.find((task) => task.id === 'a0')?.status).toBe('done');
        expect(card(container, 'aircraft')?.querySelector('[data-task-id="a0"]')).toHaveAttribute('data-completion', 'popping');
        expect(rowIds(card(container, 'aircraft'))).toEqual(['a0']);

        await act(async () => { vi.advanceTimersByTime(COMPLETION_TIMELINE.leaving + 5); });
        expect(rowIds(card(container, 'aircraft'))).toEqual(['a0', 'a1']);

        await act(async () => { vi.advanceTimersByTime(COMPLETION_TIMELINE.gone - COMPLETION_TIMELINE.leaving + 5); });
        expect(rowIds(card(container, 'aircraft'))).toEqual(['a1']);
        expect(card(container, 'aircraft')?.textContent).toContain('1 of 2');
    });

    it('does not show a task that is already in Today\'s Focus as the card\'s next action', () => {
        seed([
            makeTask('starred', { projectId: 'aircraft', order: 0, isFocusedToday: true }),
            makeTask('after', { projectId: 'aircraft', order: 1 }),
        ], [makeProject('aircraft', 0)]);
        const { container } = renderAgenda();
        expect(rowIds(card(container, 'aircraft'))).toEqual(['after']);
        expect(container.querySelector('[data-testid="todays-focus-section"] [data-task-id="starred"]')).not.toBeNull();
    });

    it('keeps a sequential project\'s blocked steps out of the card, showing them locked when expanded', () => {
        seed([
            makeTask('s0', { projectId: 'seq', order: 0 }),
            makeTask('s1', { projectId: 'seq', order: 1 }),
        ], [makeProject('seq', 0, { isSequential: true })]);
        const view = renderAgenda();
        expect(rowIds(card(view.container, 'seq'))).toEqual(['s0']);

        fireEvent.click(view.getByRole('button', { name: /Show other next actions/ }));
        expect(view.getByTestId('focus-project-locked-task').querySelector('[data-task-id="s1"]')).not.toBeNull();
        expect(view.getByText('Later steps unlock in order')).toBeInTheDocument();
    });

    it('turns Next action only on from the card menu, with undo', async () => {
        const setProjectFlowMode = vi.fn().mockResolvedValue({ success: true });
        useTaskStore.setState({ setProjectFlowMode } as never);
        seed(aircraft(2), [makeProject('aircraft', 0, { isSequential: false })]);
        const view = renderAgenda();
        fireEvent.click(view.getByRole('button', { name: /More options: Project aircraft/ }));
        await act(async () => {
            fireEvent.click(view.getByRole('menuitemcheckbox', { name: 'Next action only' }));
            await Promise.resolve();
        });
        expect(setProjectFlowMode).toHaveBeenCalledWith('aircraft', 'sequential');
        const toasts = useUiStore.getState().toasts;
        const toast = toasts[toasts.length - 1];
        expect(toast?.message).toBe('Only the next action shows in Focus');
        expect(toast?.action?.label).toBe('Undo');
    });

    it('groups loose tasks by area only when more than one is present', () => {
        const areas: Area[] = [
            { id: 'work', name: 'Work', color: '#111111', order: 0, createdAt: nowIso, updatedAt: nowIso } as Area,
        ];
        seed([makeTask('l1', { areaId: 'work' }), makeTask('l2')], [], areas);
        const view = renderAgenda();
        expect(view.getByRole('button', { name: /Work/ })).toHaveAttribute('aria-expanded', 'true');
        expect(view.getByRole('button', { name: /No Area/ })).toBeInTheDocument();
    });

    it('stays flat with no second area', () => {
        seed([makeTask('l1'), makeTask('l2')], []);
        const view = renderAgenda();
        expect(view.queryByRole('button', { name: /No Area/ })).toBeNull();
        expect(rowIds(view.container)).toEqual(expect.arrayContaining(['l1', 'l2']));
    });

    it('reorders whole cards by dragging, switching to manual order with undo', async () => {
        const reorderProjects = vi.fn().mockResolvedValue(undefined);
        useTaskStore.setState({ reorderProjects } as never);
        seed([
            makeTask('a0', { projectId: 'first' }),
            makeTask('b0', { projectId: 'second' }),
        ], [makeProject('first', 0), makeProject('second', 1)]);
        const { container } = renderAgenda();
        const row = (id: string) => container.querySelector<HTMLElement>(`[data-reorder-row="${id}"]`) as HTMLElement;
        const data = transfer();
        const headerOf = (id: string) => card(container, id)?.firstElementChild as HTMLElement;

        fireEvent.dragStart(headerOf('first'), { dataTransfer: data });
        fireEvent.dragOver(row('second'), { dataTransfer: data, clientY: 9999 });
        fireEvent.drop(row('second'), { dataTransfer: data, clientY: 9999 });

        expect(reorderProjects).toHaveBeenCalledWith(['second', 'first'], undefined);
        expect(readManualOrder(MANUAL_ORDER_KEYS.focusProjects)).toBe(true);
        const toasts = useUiStore.getState().toasts;
        const toast = toasts[toasts.length - 1];
        expect(toast?.message).toBe('Switched to manual order');
        await act(async () => {
            toast?.action?.onClick();
            await Promise.resolve();
        });
        expect(readManualOrder(MANUAL_ORDER_KEYS.focusProjects)).toBe(false);
    });

    it('reorders tasks inside an expanded card through the project order, not the card', () => {
        const reorderProjectTasks = vi.fn().mockResolvedValue(undefined);
        const reorderProjects = vi.fn().mockResolvedValue(undefined);
        useTaskStore.setState({ reorderProjectTasks, reorderProjects } as never);
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ expandedProjectCards: { aircraft: true } }));
        seed(aircraft(3), [makeProject('aircraft', 0)]);
        const { container } = renderAgenda();
        const row = (id: string) => container.querySelector<HTMLElement>(`[data-reorder-row="${id}"]`) as HTMLElement;
        const data = transfer();

        fireEvent.dragStart(container.querySelector('[data-task-id="a0"]') as HTMLElement, { dataTransfer: data });
        fireEvent.dragOver(row('a2'), { dataTransfer: data, clientY: 9999 });
        fireEvent.drop(row('a2'), { dataTransfer: data, clientY: 9999 });

        expect(reorderProjectTasks).toHaveBeenCalledWith('aircraft', ['a1', 'a2', 'a0'], undefined, 'a0');
        expect(reorderProjects).not.toHaveBeenCalled();
    });

    it('All tasks layout keeps today\'s flat list and the group control', () => {
        useUiStore.setState({ listOptions: { ...useUiStore.getState().listOptions, focusLayout: 'tasks' } });
        seed(aircraft(3), [makeProject('aircraft', 0)]);
        const { container, getByRole, getByText } = renderAgenda();
        expect(card(container, 'aircraft')).toBeNull();
        expect(rowIds(container)).toEqual(expect.arrayContaining(['a0', 'a1', 'a2']));
        expect(getByRole('radio', { name: 'All tasks' })).toHaveAttribute('aria-checked', 'true');
        expect(getByText('No grouping')).toBeInTheDocument();
    });

    it('persists the layout choice per device through listOptions', () => {
        seed(aircraft(1), [makeProject('aircraft', 0)]);
        const view = renderAgenda();
        fireEvent.click(view.getByRole('radio', { name: 'All tasks' }));
        expect(useUiStore.getState().listOptions.focusLayout).toBe('tasks');
        expect(JSON.parse(window.localStorage.getItem(LIST_OPTIONS_STORAGE_KEY) ?? '{}').focusLayout).toBe('tasks');
    });

    it('starts cards in manual order when already switched', () => {
        writeManualOrder(MANUAL_ORDER_KEYS.focusProjects, true);
        seed([
            makeTask('t-a', { projectId: 'a' }),
            makeTask('t-b', { projectId: 'b', priority: 'urgent' }),
        ], [makeProject('a', 0), makeProject('b', 1)]);
        const { container } = renderAgenda();
        const projects = Array.from(container.querySelectorAll('[data-testid="focus-project-card"]')).map((element) => element.getAttribute('data-project-id'));
        expect(projects).toEqual(['a', 'b']);
    });

    describe('AI organising', () => {
        const aiSettings = { deviceId: 'test-device', ai: { enabled: true, provider: 'openai' } };
        const looseTasks = (count: number): Task[] => Array.from({ length: count }, (_, index) => makeTask(`l${index}`));
        const seedAi = (tasks: Task[], projects: Project[] = [makeProject('aircraft', 0)]) => {
            seed(tasks, projects);
            useTaskStore.setState({ settings: aiSettings } as never);
        };
        const dismissedKey = 'stride:focus:loose-grouping-dismissed:v1';

        it('offers Group these with 4 or more loose tasks when AI is on', () => {
            seedAi([...aircraft(1), ...looseTasks(4)]);
            expect(renderAgenda().getByTestId('loose-grouping-banner')).toBeInTheDocument();
        });

        it('hides it below 4 loose tasks and when AI is off', () => {
            seedAi([...aircraft(1), ...looseTasks(3)]);
            expect(renderAgenda().queryByTestId('loose-grouping-banner')).toBeNull();
            seed([...aircraft(1), ...looseTasks(5)], [makeProject('aircraft', 0)]);
            expect(renderAgenda().queryByTestId('loose-grouping-banner')).toBeNull();
        });

        it('stays dismissed until 3 more loose tasks arrive', () => {
            window.localStorage.setItem(dismissedKey, '5');
            seedAi([...aircraft(1), ...looseTasks(7)]);
            const first = renderAgenda();
            expect(first.queryByTestId('loose-grouping-banner')).toBeNull();
            first.unmount();
            seedAi([...aircraft(1), ...looseTasks(8)]);
            expect(renderAgenda().getByTestId('loose-grouping-banner')).toBeInTheDocument();
        });

        it('puts Order this project in the card menu only when AI is on', () => {
            seedAi(aircraft(2));
            const on = renderAgenda();
            fireEvent.click(on.getByRole('button', { name: /^More options: Project aircraft$/ }));
            expect(on.getByRole('menuitem', { name: 'Order this project' })).toBeInTheDocument();
            on.unmount();

            seed(aircraft(2), [makeProject('aircraft', 0)]);
            const off = renderAgenda();
            fireEvent.click(off.getByRole('button', { name: /^More options: Project aircraft$/ }));
            expect(off.queryByRole('menuitem', { name: 'Order this project' })).toBeNull();
        });
    });
});
