import { beforeEach, describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react';
import { KeyboardSensor } from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { BoardView } from './BoardView';
import { LanguageProvider } from '../../contexts/language-context';
import { useTaskStore, type AppData, type Area, type Project, type Task } from '@stride/core';
import { useUiStore } from '../../store/ui-store';
import { expectScrolledEndGap } from '../../test/list-end-gap';
import { resetCompletionSequenceForTests } from '../../lib/completion-sequence';

const { dndSensorCalls } = vi.hoisted(() => ({
    dndSensorCalls: [] as Array<{ sensor: unknown; options: unknown }>,
}));
vi.mock('@dnd-kit/core', () => ({
    DndContext: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DragOverlay: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    KeyboardSensor: class {},
    PointerSensor: class {},
    useDroppable: () => ({ setNodeRef: () => {} }),
    useSensor: (sensor: unknown, options: unknown) => {
        dndSensorCalls.push({ sensor, options });
        return {};
    },
    useSensors: () => ([]),
    closestCorners: () => null,
}));

vi.mock('@dnd-kit/sortable', () => ({
    SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    sortableKeyboardCoordinates: () => undefined,
    verticalListSortingStrategy: {},
    useSortable: () => ({
        attributes: {},
        listeners: {},
        setNodeRef: () => {},
        transform: null,
        transition: undefined,
        isDragging: false,
    }),
}));

const renderWithProviders = () => {
    return render(
        <LanguageProvider>
            <BoardView />
        </LanguageProvider>
    );
};

const getRenderedTaskTitles = (column: HTMLElement, titles: string[]): string[] => (
    Array.from(column.querySelectorAll('[role="listitem"]'))
        .map((item) => titles.find((title) => item.textContent?.includes(title)))
        .filter((title): title is string => Boolean(title))
);

const setBoardStoreState = ({
    tasks = [],
    projects = [],
    areas = [],
    settings = {},
}: {
    tasks?: Task[];
    projects?: Project[];
    areas?: Area[];
    settings?: AppData['settings'];
}) => {
    useTaskStore.setState({
        tasks,
        projects,
        areas,
        settings,
        _allTasks: tasks,
        _allProjects: projects,
        _allAreas: areas,
    });
};

describe('BoardView', () => {
    beforeEach(() => {
        dndSensorCalls.length = 0;
        window.localStorage.clear();
        setBoardStoreState({
            tasks: [],
            projects: [],
            areas: [],
            settings: {},
        });
        useUiStore.setState({
            boardFilters: { criteria: {} },
        });
    });

    it('registers keyboard coordinates for board task reordering', () => {
        renderWithProviders();

        const keyboardSensor = dndSensorCalls.find(({ sensor }) => sensor === KeyboardSensor);
        expect(keyboardSensor?.options).toMatchObject({
            coordinateGetter: sortableKeyboardCoordinates,
        });
    });

    it('renders the column headers', () => {
        const { getByRole } = renderWithProviders();
        expect(getByRole('heading', { name: /inbox/i })).toBeInTheDocument();
        expect(getByRole('heading', { name: /next actions/i })).toBeInTheDocument();
    });

    it('ends each column scroller with the shared end gap, not with viewport padding (#977)', () => {
        const { container } = renderWithProviders();
        expectScrolledEndGap(container);
    });

    it('exposes the project filter panel state with aria-expanded', () => {
        const { getByRole } = renderWithProviders();

        const filtersButton = getByRole('button', { name: /^filters$/i });
        expect(filtersButton).toHaveAttribute('aria-expanded', 'false');

        fireEvent.click(filtersButton);
        expect(getByRole('button', { name: /^filters$/i })).toHaveAttribute('aria-expanded', 'true');
        expect(getByRole('button', { name: /^hide$/i })).toBeInTheDocument();
    });

    it('allows hiding the project filter panel after selecting a filter', () => {
        setBoardStoreState({
            tasks: [],
            projects: [{
                id: 'project-1',
                title: 'Alpha project',
                status: 'active',
                color: '#123456',
                order: 0,
                tagIds: [],
                createdAt: '2026-02-28T12:00:00.000Z',
                updatedAt: '2026-02-28T12:00:00.000Z',
            }],
            areas: [],
            settings: {},
        });

        const { getByRole, queryByRole } = renderWithProviders();

        fireEvent.click(getByRole('button', { name: /^filters$/i }));
        fireEvent.click(getByRole('button', { name: /^Projects$/i }));
        fireEvent.click(getByRole('button', { name: 'Alpha project' }));
        fireEvent.click(getByRole('button', { name: /^hide$/i }));

        expect(getByRole('button', { name: /^filters$/i })).toHaveAttribute('aria-expanded', 'false');
        expect(queryByRole('button', { name: 'Alpha project' })).not.toBeInTheDocument();
    });

    it('hides tasks that belong to deferred projects', () => {
        setBoardStoreState({
            tasks: [
                {
                    id: 'active-task',
                    title: 'Active project next action',
                    status: 'next',
                    projectId: 'active-project',
                    tags: [],
                    contexts: [],
                    createdAt: '2026-05-18T12:00:00.000Z',
                    updatedAt: '2026-05-18T12:00:00.000Z',
                },
                {
                    id: 'someday-task',
                    title: 'Someday project next action',
                    status: 'next',
                    projectId: 'someday-project',
                    tags: [],
                    contexts: [],
                    createdAt: '2026-05-18T12:00:00.000Z',
                    updatedAt: '2026-05-18T12:00:00.000Z',
                },
            ],
            projects: [
                {
                    id: 'active-project',
                    title: 'Active project',
                    status: 'active',
                    color: '#123456',
                    order: 0,
                    tagIds: [],
                    createdAt: '2026-05-18T12:00:00.000Z',
                    updatedAt: '2026-05-18T12:00:00.000Z',
                },
                {
                    id: 'someday-project',
                    title: 'Someday project',
                    status: 'someday',
                    color: '#654321',
                    order: 1,
                    tagIds: [],
                    createdAt: '2026-05-18T12:00:00.000Z',
                    updatedAt: '2026-05-18T12:00:00.000Z',
                },
            ],
            areas: [],
            settings: {},
        });

        const { getByText, queryByText } = renderWithProviders();

        expect(getByText('Active project next action')).toBeInTheDocument();
        expect(queryByText('Someday project next action')).not.toBeInTheDocument();
    });

    it('marks a focused Next task with an always-visible star and keeps other stars hover-only (#908)', () => {
        setBoardStoreState({
            tasks: [
                {
                    id: 'focused-task',
                    title: 'Focused next action',
                    status: 'next',
                    isFocusedToday: true,
                    tags: [],
                    contexts: [],
                    createdAt: '2026-05-18T12:00:00.000Z',
                    updatedAt: '2026-05-18T12:00:00.000Z',
                },
                {
                    id: 'plain-task',
                    title: 'Plain next action',
                    status: 'next',
                    tags: [],
                    contexts: [],
                    createdAt: '2026-05-18T12:00:00.000Z',
                    updatedAt: '2026-05-18T12:00:00.000Z',
                },
                {
                    id: 'inbox-task',
                    title: 'Inbox thought',
                    status: 'inbox',
                    tags: [],
                    contexts: [],
                    createdAt: '2026-05-18T12:00:00.000Z',
                    updatedAt: '2026-05-18T12:00:00.000Z',
                },
            ],
        });

        const { getByText, queryByRole } = renderWithProviders();

        const focusedCard = getByText('Focused next action').closest('[role="listitem"]') as HTMLElement;
        expect(focusedCard.querySelector('[data-focus-star-pinned]')).toBeInTheDocument();

        const plainCard = getByText('Plain next action').closest('[role="listitem"]') as HTMLElement;
        expect(plainCard.querySelector('[data-focus-star-pinned]')).not.toBeInTheDocument();

        const inboxCard = getByText('Inbox thought').closest('[role="listitem"]') as HTMLElement;
        expect(inboxCard.querySelector('[data-focus-star-pinned]')).not.toBeInTheDocument();


        expect(queryByRole('button', { name: 'Remove from focus' })).not.toBeInTheDocument();
        expect(queryByRole('button', { name: "Add to today's focus" })).not.toBeInTheDocument();
    });

    it('orders column tasks by boardOrder ahead of tasks without one', () => {
        const baseTask = {
            status: 'next' as const,
            tags: [],
            contexts: [],
            createdAt: '2026-05-18T12:00:00.000Z',
            updatedAt: '2026-05-18T12:00:00.000Z',
        };
        setBoardStoreState({
            tasks: [
                { ...baseTask, id: 'task-q', title: 'Task Q', boardOrder: 1 },
                { ...baseTask, id: 'task-w', title: 'Task W', boardOrder: 2 },
                { ...baseTask, id: 'task-e', title: 'Task E', boardOrder: 0 },
                { ...baseTask, id: 'task-r', title: 'Task R' },
            ],
            projects: [],
            areas: [],
            settings: {},
        });

        const { getByRole } = renderWithProviders();

        const column = getByRole('list', { name: /next actions tasks list/i });
        const titles = getRenderedTaskTitles(column, ['Task Q', 'Task W', 'Task E', 'Task R']);
        expect(titles).toEqual(['Task E', 'Task Q', 'Task W', 'Task R']);
    });

    it('filters board tasks to the selected context', () => {
        setBoardStoreState({
            tasks: [
                {
                    id: 'work-task',
                    title: 'Work task',
                    status: 'next',
                    contexts: ['@work'],
                    tags: [],
                    createdAt: '2026-05-18T12:00:00.000Z',
                    updatedAt: '2026-05-18T12:00:00.000Z',
                },
                {
                    id: 'home-task',
                    title: 'Home task',
                    status: 'next',
                    contexts: ['@home'],
                    tags: [],
                    createdAt: '2026-05-18T12:00:00.000Z',
                    updatedAt: '2026-05-18T12:00:00.000Z',
                },
            ],
            projects: [],
            areas: [],
            settings: {},
        });
        useUiStore.setState({ boardFilters: { criteria: { contexts: ['@work'] } } });

        const { getByText, queryByText } = renderWithProviders();

        expect(getByText('Work task')).toBeInTheDocument();
        expect(queryByText('Home task')).not.toBeInTheDocument();
    });

    it('never shows a later sequential step when a filter hides the current one', async () => {
        const at = '2026-05-18T12:00:00.000Z';
        const step = (id: string, title: string, order: number, contexts: string[]): Task => ({
            id, title, status: 'next', projectId: 'trip', order, contexts, tags: [], createdAt: at, updatedAt: at,
        });
        setBoardStoreState({
            tasks: [step('find-site', 'Find campsite', 1, ['@home']), step('reserve-site', 'Reserve campsite', 2, ['@work'])],
            projects: [{ id: 'trip', title: 'Camping Trip', status: 'active', color: '#123456', order: 0, tagIds: [],
                isSequential: true, createdAt: at, updatedAt: at }],
        });
        useUiStore.setState({ boardFilters: { criteria: { contexts: ['@work'] } } });

        const { queryByText } = renderWithProviders();

        await waitFor(() => expect(queryByText('Reserve campsite')).not.toBeInTheDocument());
        expect(queryByText('Find campsite')).not.toBeInTheDocument();
    });

    it('filters board tasks by the selected due-date preset', () => {
        setBoardStoreState({
            tasks: [
                {
                    id: 'overdue-task',
                    title: 'Overdue task',
                    status: 'next',
                    dueDate: '2020-01-01',
                    contexts: [],
                    tags: [],
                    createdAt: '2026-05-18T12:00:00.000Z',
                    updatedAt: '2026-05-18T12:00:00.000Z',
                },
                {
                    id: 'future-task',
                    title: 'Future task',
                    status: 'next',
                    dueDate: '2999-01-01',
                    contexts: [],
                    tags: [],
                    createdAt: '2026-05-18T12:00:00.000Z',
                    updatedAt: '2026-05-18T12:00:00.000Z',
                },
            ],
            projects: [],
            areas: [],
            settings: {},
        });
        useUiStore.setState({ boardFilters: { criteria: { dueDateRange: { preset: 'overdue' } } } });

        const { getByText, queryByText } = renderWithProviders();

        expect(getByText('Overdue task')).toBeInTheDocument();
        expect(queryByText('Future task')).not.toBeInTheDocument();
    });

    it('toggles a context filter from the board filter panel', () => {
        setBoardStoreState({
            tasks: [
                {
                    id: 'work-task',
                    title: 'Work task',
                    status: 'next',
                    contexts: ['@work'],
                    tags: [],
                    createdAt: '2026-05-18T12:00:00.000Z',
                    updatedAt: '2026-05-18T12:00:00.000Z',
                },
                {
                    id: 'home-task',
                    title: 'Home task',
                    status: 'next',
                    contexts: ['@home'],
                    tags: [],
                    createdAt: '2026-05-18T12:00:00.000Z',
                    updatedAt: '2026-05-18T12:00:00.000Z',
                },
            ],
            projects: [],
            areas: [],
            settings: {},
        });

        const { getByRole, getByText, queryByText } = renderWithProviders();

        fireEvent.click(getByRole('button', { name: /^filters$/i }));
        fireEvent.click(getByRole('button', { name: /^Contexts & tags$/i }));
        fireEvent.click(getByRole('button', { name: '@work' }));

        expect(getByText('Work task')).toBeInTheDocument();
        expect(queryByText('Home task')).not.toBeInTheDocument();
    });

    it('keeps the filters panel open when Escape comes from outside it', () => {
        const { getByRole } = renderWithProviders();

        fireEvent.click(getByRole('button', { name: /^filters$/i }));
        fireEvent.keyDown(document.body, { key: 'Escape' });

        expect(getByRole('button', { name: /^filters$/i })).toHaveAttribute('aria-expanded', 'true');
    });

    it('shows the match mode the board actually filters with', () => {
        setBoardStoreState({
            tasks: [
                {
                    id: 'work-task',
                    title: 'Work task',
                    status: 'next',
                    contexts: ['@work'],
                    tags: [],
                    createdAt: '2026-05-18T12:00:00.000Z',
                    updatedAt: '2026-05-18T12:00:00.000Z',
                },
                {
                    id: 'both-task',
                    title: 'Both task',
                    status: 'next',
                    contexts: ['@work', '@home'],
                    tags: [],
                    createdAt: '2026-05-18T12:00:00.000Z',
                    updatedAt: '2026-05-18T12:00:00.000Z',
                },
            ],
            projects: [],
            areas: [],
            settings: {},
        });
        useUiStore.setState({ boardFilters: { criteria: { contexts: ['@work', '@home'] } } });

        const { getByRole, getByText } = renderWithProviders();

        fireEvent.click(getByRole('button', { name: /^filters$/i }));
        fireEvent.click(getByRole('button', { name: /^Contexts & tags$/i }));

        const matchGroup = getByRole('group', { name: /context match/i });
        expect(within(matchGroup).getByRole('button', { name: 'Any' })).toHaveAttribute('aria-pressed', 'true');
        expect(within(matchGroup).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false');


        expect(getByText('Work task')).toBeInTheDocument();
        expect(getByText('Both task')).toBeInTheDocument();
    });

    it('cycles a board token chip included → excluded → neutral', () => {
        setBoardStoreState({
            tasks: [
                {
                    id: 'work-task',
                    title: 'Work task',
                    status: 'next',
                    contexts: ['@work'],
                    tags: [],
                    createdAt: '2026-05-18T12:00:00.000Z',
                    updatedAt: '2026-05-18T12:00:00.000Z',
                },
                {
                    id: 'home-task',
                    title: 'Home task',
                    status: 'next',
                    contexts: ['@home'],
                    tags: ['#chore'],
                    createdAt: '2026-05-18T12:00:00.000Z',
                    updatedAt: '2026-05-18T12:00:00.000Z',
                },
            ],
            projects: [],
            areas: [],
            settings: {},
        });

        const { getByRole, getByText, queryByText } = renderWithProviders();
        fireEvent.click(getByRole('button', { name: /^filters$/i }));
        fireEvent.click(getByRole('button', { name: /^Contexts & tags$/i }));

        fireEvent.click(getByRole('button', { name: '@work' }));
        expect(useUiStore.getState().boardFilters.criteria.contexts).toEqual(['@work']);


        fireEvent.click(getByRole('button', { name: '@work' }));
        const excludedCriteria = useUiStore.getState().boardFilters.criteria;
        expect(excludedCriteria.excludedContexts).toEqual(['@work']);
        expect(excludedCriteria.contexts).toBeUndefined();
        const excludedChip = getByRole('button', { name: '@work (Excluded)' });
        expect(excludedChip).toHaveAttribute('aria-pressed', 'mixed');
        expect(excludedChip).toHaveClass('line-through');
        expect(getByText('Home task')).toBeInTheDocument();
        expect(queryByText('Work task')).not.toBeInTheDocument();


        fireEvent.click(excludedChip);
        expect(useUiStore.getState().boardFilters.criteria.excludedContexts).toBeUndefined();
        expect(getByText('Work task')).toBeInTheDocument();
        expect(getByText('Home task')).toBeInTheDocument();
    });

    it('excludes a tag chip through the excludedTags criteria', () => {
        setBoardStoreState({
            tasks: [
                {
                    id: 'chore-task',
                    title: 'Chore task',
                    status: 'next',
                    contexts: [],
                    tags: ['#chore'],
                    createdAt: '2026-05-18T12:00:00.000Z',
                    updatedAt: '2026-05-18T12:00:00.000Z',
                },
                {
                    id: 'plain-task',
                    title: 'Plain task',
                    status: 'next',
                    contexts: [],
                    tags: [],
                    createdAt: '2026-05-18T12:00:00.000Z',
                    updatedAt: '2026-05-18T12:00:00.000Z',
                },
            ],
            projects: [],
            areas: [],
            settings: {},
        });

        const { getByRole, getByText, queryByText } = renderWithProviders();
        fireEvent.click(getByRole('button', { name: /^filters$/i }));
        fireEvent.click(getByRole('button', { name: /^Contexts & tags$/i }));

        fireEvent.click(getByRole('button', { name: '#chore' }));
        fireEvent.click(getByRole('button', { name: '#chore' }));

        expect(useUiStore.getState().boardFilters.criteria.excludedTags).toEqual(['#chore']);
        expect(getByText('Plain task')).toBeInTheDocument();
        expect(queryByText('Chore task')).not.toBeInTheDocument();
    });

    it('uses the selected task sort instead of manual board order when non-default sort is selected', () => {
        const baseTask = {
            status: 'next' as const,
            tags: [],
            contexts: [],
            createdAt: '2026-05-18T12:00:00.000Z',
            updatedAt: '2026-05-18T12:00:00.000Z',
        };
        setBoardStoreState({
            tasks: [
                { ...baseTask, id: 'task-q', title: 'Task Q', boardOrder: 1, createdAt: '2026-05-18T12:00:00.000Z' },
                { ...baseTask, id: 'task-w', title: 'Task W', boardOrder: 2, createdAt: '2026-05-19T12:00:00.000Z' },
                { ...baseTask, id: 'task-e', title: 'Task E', boardOrder: 0, createdAt: '2026-05-20T12:00:00.000Z' },
                { ...baseTask, id: 'task-r', title: 'Task R', createdAt: '2026-05-21T12:00:00.000Z' },
            ],
            projects: [],
            areas: [],
            settings: { taskSortBy: 'created-desc' },
        });

        const { getByRole, getByText } = renderWithProviders();

        const column = getByRole('list', { name: /next actions tasks list/i });
        const titles = getRenderedTaskTitles(column, ['Task Q', 'Task W', 'Task E', 'Task R']);
        expect(titles).toEqual(['Task R', 'Task E', 'Task W', 'Task Q']);
        expect(getByText('Ordering follows the selected sort. Switch to default sort to reorder cards.')).toBeInTheDocument();
    });

    it('uses fixed-width, non-stretching columns with an independent vertical scroller', () => {
        const { container } = renderWithProviders();
        const columns = container.querySelectorAll('[data-board-column]');
        expect(columns).toHaveLength(5);
        for (const column of Array.from(columns)) {
            expect(column.className).toContain('clamp(248px');
            expect(column.className).toContain('288px)]');
            expect(column.className).toContain('min-w-[248px]');
            expect(column.className).toContain('max-w-[320px]');
            expect(column.className).toContain('flex-none');
            expect(column.className).toContain('max-h-full');
        }
        const row = container.querySelector('[data-board-columns]') as HTMLElement;
        expect(row.className).toContain('items-start');
        expect(row.className).toContain('gap-3');
        expect((container.querySelector('[data-board-scroller]') as HTMLElement).className).toContain('overflow-x-auto');
    });

    it('renders the priority as a chip in the chip row, never absolutely positioned over the title', () => {
        setBoardStoreState({
            tasks: [{
                id: 'p1',
                title: 'Open company current account at Indiranagar HDFC branch with a very long title',
                status: 'next',
                priority: 'high',
                tags: ['#finance'],
                contexts: [],
                createdAt: '2026-05-18T12:00:00.000Z',
                updatedAt: '2026-05-18T12:00:00.000Z',
            }],
            settings: { features: { priorities: true } } as AppData['settings'],
        });
        const { container } = renderWithProviders();
        const priority = container.querySelector('[data-board-priority]') as HTMLElement;
        expect(priority).toBeInTheDocument();
        expect(priority.closest('[data-board-card-chips]')).toBeInTheDocument();
        expect(priority.className).not.toMatch(/absolute/);
        const title = container.querySelector('[data-board-card-title]') as HTMLElement;
        expect(title.contains(priority)).toBe(false);
        expect(title.className).toContain('break-words');
        expect(container.querySelectorAll('[data-board-card-id] [class*="absolute"]:not([data-board-drop-line])')).toHaveLength(0);
    });

    it('strikes through and mutes done cards', () => {
        setBoardStoreState({
            tasks: [{
                id: 'd1', title: 'Finished thing', status: 'done', tags: [], contexts: [],
                createdAt: '2026-05-18T12:00:00.000Z', updatedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
            }],
        });
        const { getByText } = renderWithProviders();
        expect(getByText('Finished thing').className).toContain('completion-strike');
    });

    it('moves a card across columns with Alt+Arrow and reorders it with Alt+Up/Down', () => {
        const moveTask = vi.fn().mockResolvedValue(undefined);
        const reorderBoardTasks = vi.fn().mockResolvedValue(undefined);
        const base = {
            status: 'next' as const, tags: [], contexts: [],
            createdAt: '2026-05-18T12:00:00.000Z', updatedAt: '2026-05-18T12:00:00.000Z',
        };
        setBoardStoreState({
            tasks: [
                { ...base, id: 'a', title: 'Card A', boardOrder: 0 },
                { ...base, id: 'b', title: 'Card B', boardOrder: 1 },
            ],
        });
        useTaskStore.setState({ moveTask, reorderBoardTasks } as never);
        const { getByRole } = renderWithProviders();
        const column = getByRole('list', { name: /next actions tasks list/i });
        const card = within(column).getByRole('group', { name: 'Card A' });

        fireEvent.keyDown(card, { key: 'ArrowDown', altKey: true });
        expect(reorderBoardTasks).toHaveBeenCalledWith('next', ['b', 'a']);

        fireEvent.keyDown(card, { key: 'ArrowRight', altKey: true });
        expect(moveTask).toHaveBeenCalledWith('a', 'waiting');

        fireEvent.keyDown(card, { key: 'ArrowLeft', altKey: true });
        expect(moveTask).toHaveBeenCalledWith('a', 'inbox');
    });

    it('opens the task editor with Enter on a focused card', () => {
        setBoardStoreState({
            tasks: [{
                id: 'e1', title: 'Editable card', status: 'next', tags: [], contexts: [],
                createdAt: '2026-05-18T12:00:00.000Z', updatedAt: '2026-05-18T12:00:00.000Z',
            }],
        });
        const { getByRole } = renderWithProviders();
        fireEvent.keyDown(getByRole('group', { name: 'Editable card' }), { key: 'Enter' });
        expect(useUiStore.getState().editingTaskId).toBe('e1');
        useUiStore.setState({ editingTaskId: null });
    });

    it('shows a dashed drop zone and an add-card footer in empty columns', () => {
        const { container, getAllByRole } = renderWithProviders();
        expect(container.querySelectorAll('[data-board-empty]')).toHaveLength(5);
        expect(getAllByRole('button', { name: 'Add a card' })).toHaveLength(5);
    });

    describe('board interactions', () => {
        const base = {
            status: 'next' as const, tags: [], contexts: [],
            createdAt: '2026-05-18T12:00:00.000Z', updatedAt: '2026-05-18T12:00:00.000Z',
        };
        const nextColumn = (utils: ReturnType<typeof renderWithProviders>) => utils.getByRole('region', { name: /next actions/i });

        it('adds cards from an inline composer: Enter creates and keeps it open, Escape closes', async () => {
            const addTask = vi.fn().mockResolvedValue({ success: true, id: 'new-1' });
            useTaskStore.setState({ addTask } as never);
            const utils = renderWithProviders();
            fireEvent.click(within(nextColumn(utils)).getByRole('button', { name: 'Add a card' }));
            const box = within(nextColumn(utils)).getByRole('textbox') as HTMLTextAreaElement;
            expect(box).toHaveFocus();
            fireEvent.change(box, { target: { value: 'Write report' } });
            fireEvent.keyDown(box, { key: 'Enter' });
            await waitFor(() => expect(addTask).toHaveBeenCalledTimes(1));
            expect(addTask.mock.calls[0][0]).toBe('Write report');
            expect(addTask.mock.calls[0][1]).toMatchObject({ status: 'next' });
            const again = within(nextColumn(utils)).getByRole('textbox') as HTMLTextAreaElement;
            expect(again.value).toBe('');
            fireEvent.keyDown(again, { key: 'Escape' });
            expect(within(nextColumn(utils)).queryByRole('textbox')).not.toBeInTheDocument();
        });

        it('closes an empty composer on blur', () => {
            const utils = renderWithProviders();
            fireEvent.click(within(nextColumn(utils)).getByRole('button', { name: 'Add a card' }));
            fireEvent.blur(within(nextColumn(utils)).getByRole('textbox'));
            expect(within(nextColumn(utils)).queryByRole('textbox')).not.toBeInTheDocument();
        });

        it('opens a column menu with collapse, hide and sort, and persists collapse and hide', () => {
            const utils = renderWithProviders();
            fireEvent.click(utils.getByRole('button', { name: /column options: next actions/i }));
            const menu = utils.getByRole('menu');
            expect(within(menu).getByRole('menuitem', { name: /add a card at the top/i })).toBeInTheDocument();
            expect(within(menu).getByRole('menuitemradio', { name: 'Manual' })).toHaveAttribute('aria-checked', 'true');
            fireEvent.click(within(menu).getByRole('menuitem', { name: /collapse column/i }));
            expect(utils.container.querySelector('[data-board-column="next"]')).toHaveAttribute('data-board-collapsed', 'true');
            expect(JSON.parse(window.localStorage.getItem('stride:view:board:v1') ?? '{}').collapsed).toEqual(['next']);

            fireEvent.click(utils.getByRole('button', { name: /column options: inbox/i }));
            fireEvent.click(within(utils.getByRole('menu')).getByRole('menuitem', { name: /hide column/i }));
            expect(utils.container.querySelector('[data-board-column="inbox"]')).toBeNull();
            expect(JSON.parse(window.localStorage.getItem('stride:view:board:v1') ?? '{}').hidden).toEqual(['inbox']);
            fireEvent.click(utils.getByRole('button', { name: /hidden columns/i }));
            fireEvent.click(within(utils.getByRole('menu')).getByRole('menuitem', { name: /inbox/i }));
            expect(utils.container.querySelector('[data-board-column="inbox"]')).not.toBeNull();
        });

        it('offers Archive all done only in the Done column menu', () => {
            const utils = renderWithProviders();
            fireEvent.click(utils.getByRole('button', { name: /column options: completed/i }));
            expect(within(utils.getByRole('menu')).getByRole('menuitem', { name: /archive all done/i })).toBeInTheDocument();
        });

        it('context menu moves, reorders, completes and deletes a card', () => {
            const moveTask = vi.fn().mockResolvedValue({ success: true });
            const reorderBoardTasks = vi.fn().mockResolvedValue({ success: true });
            const deleteTask = vi.fn().mockResolvedValue({ success: true });
            setBoardStoreState({ tasks: [
                { ...base, id: 'a', title: 'Card A', boardOrder: 0 },
                { ...base, id: 'b', title: 'Card B', boardOrder: 1 },
            ] });
            useTaskStore.setState({ moveTask, reorderBoardTasks, deleteTask } as never);
            const utils = renderWithProviders();
            const open = () => fireEvent.contextMenu(utils.getByRole('group', { name: 'Card A' }));

            open();
            expect(within(utils.getByRole('menu')).getByRole('menuitem', { name: 'Next Actions' })).toBeDisabled();
            fireEvent.click(within(utils.getByRole('menu')).getByRole('menuitem', { name: 'Waiting For' }));
            expect(moveTask).toHaveBeenCalledWith('a', 'waiting');

            open();
            fireEvent.click(within(utils.getByRole('menu')).getByRole('menuitem', { name: /move to bottom/i }));
            expect(reorderBoardTasks).toHaveBeenCalledWith('next', ['b', 'a']);

            open();
            fireEvent.click(within(utils.getByRole('menu')).getByRole('menuitem', { name: /^open$/i }));
            expect(useUiStore.getState().editingTaskId).toBe('a');
            useUiStore.setState({ editingTaskId: null });

            open();
            fireEvent.click(within(utils.getByRole('menu')).getByRole('menuitem', { name: /mark done/i }));
            expect(moveTask).toHaveBeenCalledWith('a', 'done');

            open();
            fireEvent.click(within(utils.getByRole('menu')).getByRole('menuitem', { name: /delete/i }));
            expect(deleteTask).toHaveBeenCalledWith('a');
        });

        it('has a hover menu button for each card and keeps Alt+Arrow moves', () => {
            setBoardStoreState({ tasks: [{ ...base, id: 'a', title: 'Card A' }] });
            const utils = renderWithProviders();
            const button = utils.container.querySelector('[data-board-card-menu]') as HTMLElement;
            expect(button).toBeInTheDocument();
            expect(button.closest('[data-board-card-title]')).toBeNull();
            fireEvent.click(button);
            expect(utils.getByRole('menu')).toBeInTheDocument();
        });

        it('opens done cards and reopens to the previous status', () => {
            const moveTask = vi.fn().mockResolvedValue({ success: true });
            setBoardStoreState({ tasks: [{ ...base, id: 'w', title: 'Waiting card', status: 'waiting' }] });
            useTaskStore.setState({ moveTask } as never);
            const utils = renderWithProviders();
            fireEvent.click(within(utils.getByRole('group', { name: 'Waiting card' })).getByRole('button', { name: /mark done/i }));
            expect(moveTask).toHaveBeenCalledWith('w', 'done');

            setBoardStoreState({ tasks: [{ ...base, id: 'w', title: 'Waiting card', status: 'done', completedAt: new Date().toISOString() }] });
            utils.rerender(<LanguageProvider><BoardView /></LanguageProvider>);
            fireEvent.keyDown(utils.getByRole('group', { name: 'Waiting card' }), { key: 'Enter' });
            expect(useUiStore.getState().editingTaskId).toBe('w');
            useUiStore.setState({ editingTaskId: null });
            // The tick's sequence has finished (a reopen straight after the tick is a double click).
            act(() => resetCompletionSequenceForTests());
            fireEvent.click(within(utils.getByRole('group', { name: 'Waiting card' })).getByRole('button', { name: /reopen/i }));
            expect(moveTask).toHaveBeenLastCalledWith('w', 'waiting');
        });

        it('reopens to Next when the previous status is unknown', () => {
            const moveTask = vi.fn().mockResolvedValue({ success: true });
            setBoardStoreState({ tasks: [{ ...base, id: 'x', title: 'Old done', status: 'done', completedAt: new Date().toISOString() }] });
            useTaskStore.setState({ moveTask } as never);
            const utils = renderWithProviders();
            fireEvent.click(within(utils.getByRole('group', { name: 'Old done' })).getByRole('button', { name: /reopen/i }));
            expect(moveTask).toHaveBeenCalledWith('x', 'next');
        });

        it('shows only the last 7 days of completions with a Show older row', () => {
            const day = 24 * 60 * 60 * 1000;
            setBoardStoreState({ tasks: [
                { ...base, id: 'r', title: 'Recent done', status: 'done', completedAt: new Date(Date.now() - day).toISOString() },
                { ...base, id: 'o1', title: 'Old done one', status: 'done', completedAt: new Date(Date.now() - 20 * day).toISOString() },
                { ...base, id: 'o2', title: 'Old done two', status: 'done', completedAt: new Date(Date.now() - 30 * day).toISOString() },
            ] });
            const utils = renderWithProviders();
            expect(utils.queryByText('Recent done')).toBeInTheDocument();
            expect(utils.queryByText('Old done one')).not.toBeInTheDocument();
            fireEvent.click(utils.getByRole('button', { name: 'Show older (2)' }));
            expect(utils.getByText('Old done one')).toBeInTheDocument();
            expect(utils.getByText('Old done two')).toBeInTheDocument();
        });

        it('uses a roving tabindex and arrow keys to move focus between cards', () => {
            setBoardStoreState({ tasks: [
                { ...base, id: 'a', title: 'Card A', boardOrder: 0 },
                { ...base, id: 'b', title: 'Card B', boardOrder: 1 },
                { ...base, id: 'c', title: 'Card C', status: 'waiting', boardOrder: 0 },
            ] });
            const utils = renderWithProviders();
            const a = utils.getByRole('group', { name: 'Card A' });
            const b = utils.getByRole('group', { name: 'Card B' });
            const c = utils.getByRole('group', { name: 'Card C' });
            const tabStops = () => utils.container.querySelectorAll('[tabindex="0"]');
            expect(a).toHaveAttribute('tabindex', '0');
            expect(b).toHaveAttribute('tabindex', '-1');
            expect(c).toHaveAttribute('tabindex', '-1');
            // Empty columns are the only other tab stops (they have no focusable cards).
            expect(Array.from(tabStops()).filter((el) => el.hasAttribute('data-board-card'))).toHaveLength(1);

            a.focus();
            fireEvent.keyDown(a, { key: 'ArrowDown' });
            return waitFor(() => expect(b).toHaveFocus()).then(() => {
                fireEvent.keyDown(b, { key: 'ArrowRight' });
                return waitFor(() => expect(c).toHaveFocus());
            }).then(() => {
                expect(c).toHaveAttribute('tabindex', '0');
                expect(b).toHaveAttribute('tabindex', '-1');
            });
        });

        it('starts with the board scrolled fully left', () => {
            let scrollLeft = 120;
            const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollLeft');
            Object.defineProperty(HTMLElement.prototype, 'scrollLeft', {
                configurable: true,
                get: () => scrollLeft,
                set: (value: number) => { scrollLeft = value; },
            });
            try {
                renderWithProviders();
                expect(scrollLeft).toBe(0);
            } finally {
                if (descriptor) Object.defineProperty(HTMLElement.prototype, 'scrollLeft', descriptor);
                else delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollLeft;
            }
        });
    });
});
