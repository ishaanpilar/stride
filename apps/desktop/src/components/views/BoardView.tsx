import { getProjectAccentColor } from '@stride/core';
import React from 'react';
import {
    DndContext,
    DragOverlay,
    DragEndEvent,
    DragOverEvent,
    DragStartEvent,
    closestCorners,
    closestCenter,
    pointerWithin,
    rectIntersection,
    getFirstCollision,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    type CollisionDetection,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { ViewHeader } from '../ui/ViewHeader';
import { ErrorBoundary } from '../ErrorBoundary';
import { executeCaptureTransaction, parseQuickAdd, buildQuickAddParseOptions, safeParseDate, resolveFeatureFlags, shallow, useTaskStore, sortTasksBy, sortTasksByBoardOrder, buildProjectOrderMap, compareTasksByProjectThenOrder, getSequentialFirstTaskIds, getTaskSequencing, hasTaskSequences, isSequentialChainStatus, isTaskSequenceBlocked, translateWithFallback, createTaskFilterPredicate, hasActiveFilterCriteria, getUsedTaskTokens, tFallback } from '@stride/core';
import { buildActiveFilterChips, removeFilterChipFromCriteria } from './list/active-filter-chips';
import { resolveBoardDragEnd, resolveBoardEdgeMove, resolveBoardKeyboardMove, type BoardDragEndAction, type BoardKeyboardDirection } from './board-view-dnd';
import { BoardColumn, type BoardDropIndicator, type BoardComposerState, type BoardColumnLabels } from './board/BoardColumn';
import { BoardMenu, type BoardMenuAnchor, type BoardMenuItem } from './board/BoardMenu';
import { deleteTaskWithUndo } from '../Task/useTaskQuickActionMenuProps';
import { showUndoToast } from '../../lib/undo-registry';
import { BoardCardOverlay, type BoardCardProject } from './board/BoardCard';
import type { Task, TaskStatus, FilterCriteria } from '@stride/core';
import { useLanguage } from '../../contexts/language-context';
import { Columns3, Filter } from 'lucide-react';
import { useUiStore } from '../../store/ui-store';
import { usePerformanceMonitor } from '../../hooks/usePerformanceMonitor';
import { checkBudget } from '../../config/performanceBudgets';
import { isTaskVisibleInArea, projectMatchesAreaFilterSelection } from '@stride/core';
import { useAreaVisibility } from '../../hooks/useVisibleTaskContext';
import { usePersistedViewState } from '../../hooks/usePersistedViewState';
import { useTaskListScope } from './list/task-list-scope';
import { ToolbarButton, VIEW_FILTER_INPUT } from './list/list-toolbar';
import { resolveNonDoneTaskSortBy } from '@stride/core';
import { BoardFiltersPanel } from './board/BoardFiltersPanel';
import type { DesktopActiveFilterChip } from './list/FilterDisclosure';
import { beginRendererActivity, recordRendererActivity } from '../../lib/renderer-navigation-diagnostics';
import { MOTION_EASING, canAnimate } from '../../lib/motion';

const BOARD_DROP_ANIMATION = { duration: 260, easing: MOTION_EASING.out };

const BOARD_VIEW_STATE_STORAGE_KEY = 'stride:view:board:v1';

const COLUMN_STATUSES: TaskStatus[] = ['inbox', 'next', 'waiting', 'someday', 'done'];
const DONE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PREVIOUS_STATUSES = 300;

type BoardPersistedViewState = {
    filtersOpen: boolean;
    collapsed: TaskStatus[];
    hidden: TaskStatus[];
    /** Last non-done status of tasks completed from the board, so Reopen can restore it. */
    previousStatus: Record<string, TaskStatus>;
};

const DEFAULT_BOARD_VIEW_STATE: BoardPersistedViewState = {
    filtersOpen: false,
    collapsed: [],
    hidden: [],
    previousStatus: {},
};

const sanitizeStatusList = (value: unknown): TaskStatus[] => (
    Array.isArray(value) ? COLUMN_STATUSES.filter((status) => value.includes(status)) : []
);

function sanitizeBoardViewState(value: unknown, fallback: BoardPersistedViewState): BoardPersistedViewState {
    const parsed = value && typeof value === 'object' && !Array.isArray(value)
        ? value as Partial<BoardPersistedViewState>
        : {};
    const previousStatus: Record<string, TaskStatus> = {};
    if (parsed.previousStatus && typeof parsed.previousStatus === 'object') {
        for (const [id, status] of Object.entries(parsed.previousStatus)) {
            if (COLUMN_STATUSES.includes(status as TaskStatus) && status !== 'done') previousStatus[id] = status as TaskStatus;
        }
    }
    return {
        filtersOpen: typeof parsed.filtersOpen === 'boolean' ? parsed.filtersOpen : fallback.filtersOpen,
        collapsed: sanitizeStatusList(parsed.collapsed),
        hidden: sanitizeStatusList(parsed.hidden),
        previousStatus,
    };
}

const getColumns = (t: (key: string) => string): { id: TaskStatus; label: string }[] => [
    { id: 'inbox', label: tFallback(t, 'list.inbox', 'Inbox') },
    { id: 'next', label: t('list.next') },
    { id: 'waiting', label: t('list.waiting') },
    { id: 'someday', label: t('list.someday') },
    { id: 'done', label: t('list.done') },
];

const DUE_DATE_PRESETS = ['today', 'this_week', 'this_month', 'overdue', 'no_date'] as const;
type DueDatePreset = (typeof DUE_DATE_PRESETS)[number];

export function BoardView() {
    const perf = usePerformanceMonitor('BoardView');
    const { tasks, moveTask, reorderBoardTasks, settings, projects, sections } = useTaskStore(
        (state) => ({
            tasks: state.tasks,
            moveTask: state.moveTask,
            reorderBoardTasks: state.reorderBoardTasks,
            settings: state.settings,
            projects: state.projects,
            sections: state.sections,
        }),
        shallow
    );
    const { t } = useLanguage();
    const sortBy = resolveNonDoneTaskSortBy(settings?.taskSortBy, settings);
    const isDense = (settings?.appearance?.density ?? 'comfortable') !== 'comfortable';

    const [activeTask, setActiveTask] = React.useState<Task | null>(null);
    const [computeSequential, setComputeSequential] = React.useState(false);
    const sequentialActivity = React.useRef<ReturnType<typeof beginRendererActivity>>(null);
    const sequentialPhase = React.useRef<'scheduled' | 'fired' | 'committed'>('scheduled');
    const [searchQuery, setSearchQuery] = React.useState('');
    const boardFilters = useUiStore((state) => state.boardFilters);
    const setBoardFilters = useUiStore((state) => state.setBoardFilters);
    const [persistedViewState, setPersistedViewState] = usePersistedViewState(
        BOARD_VIEW_STATE_STORAGE_KEY,
        DEFAULT_BOARD_VIEW_STATE,
        sanitizeBoardViewState
    );
    const criteria = boardFilters.criteria;
    const COLUMNS = getColumns(t);
    const hasFilters = hasActiveFilterCriteria(criteria);
    const hasSearch = searchQuery.trim().length > 0;
    const hasBoardFilters = hasFilters || hasSearch;
    const showFiltersPanel = persistedViewState.filtersOpen;
    const selectedContexts = criteria.contexts ?? [];
    const selectedTags = criteria.tags ?? [];
    const excludedContexts = criteria.excludedContexts ?? [];
    const excludedTags = criteria.excludedTags ?? [];
    const selectedTokens = [...selectedContexts, ...selectedTags];
    const excludedTokens = [...excludedContexts, ...excludedTags];
    const selectedProjectIds = criteria.projects ?? [];
    const selectedDuePreset = criteria.dueDateRange && 'preset' in criteria.dueDateRange
        ? criteria.dueDateRange.preset
        : undefined;
    const visibility = useAreaVisibility();
    const { areaById, resolvedAreaFilter } = visibility;
    const sortedProjects = React.useMemo(
        () =>
            projects
                .filter((project) => !project.deletedAt)
                .filter((project) => projectMatchesAreaFilterSelection(project, resolvedAreaFilter, areaById))
                .sort((a, b) => a.title.localeCompare(b.title)),
        [projects, resolvedAreaFilter, areaById]
    );
    const projectOrderMap = React.useMemo(() => buildProjectOrderMap(projects), [projects]);
    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 6,
            },
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
            // Enter opens the task, so keyboard dragging starts and ends with Space only.
            keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] },
        })
    );

    React.useEffect(() => {
        if (!perf.enabled) return;
        const timer = window.setTimeout(() => {
            checkBudget('BoardView', perf.metrics, 'complex');
        }, 0);
        return () => window.clearTimeout(timer);
    }, [perf.enabled]);

    React.useEffect(() => {
        const activity = beginRendererActivity('board-sequential');
        sequentialActivity.current = activity;
        sequentialPhase.current = 'scheduled';
        let fired = false;
        recordRendererActivity(activity, 'scheduled');
        const timer = window.setTimeout(() => {
            fired = true;
            sequentialPhase.current = 'fired';
            recordRendererActivity(activity, 'fired');
            setComputeSequential(true);
        }, 0);
        return () => {
            window.clearTimeout(timer);
            recordRendererActivity(activity, 'cleanup', { outcome: fired ? 'already-fired' : 'cancelled' });
        };
    }, []);
    const updateCriteria = (next: FilterCriteria) => {
        setBoardFilters({ criteria: next });
    };
    const toggleStringValue = (key: 'contexts' | 'tags' | 'projects', value: string) => {
        const current = criteria[key] ?? [];
        const next = current.includes(value)
            ? current.filter((item) => item !== value)
            : [...current, value];
        updateCriteria({ ...criteria, [key]: next.length > 0 ? next : undefined });
    };
    const toggleToken = (token: string) => {
        const isTag = token.trim().startsWith('#');
        const includeKey = isTag ? 'tags' : 'contexts';
        const excludeKey = isTag ? 'excludedTags' : 'excludedContexts';
        const included = criteria[includeKey] ?? [];
        const excluded = criteria[excludeKey] ?? [];


        const next = included.includes(token)
            ? { include: included.filter((item) => item !== token), exclude: [...excluded, token] }
            : excluded.includes(token)
                ? { include: included, exclude: excluded.filter((item) => item !== token) }
                : { include: [...included, token], exclude: excluded };
        updateCriteria({
            ...criteria,
            [includeKey]: next.include.length > 0 ? next.include : undefined,
            [excludeKey]: next.exclude.length > 0 ? next.exclude : undefined,
        });
    };
    const toggleProjectFilter = (projectId: string) => {
        toggleStringValue('projects', projectId);
    };
    const toggleDuePreset = (preset: DueDatePreset) => {
        updateCriteria({
            ...criteria,
            dueDateRange: selectedDuePreset === preset ? undefined : { preset },
        });
    };
    const setMatchMode = (kind: 'context' | 'tag', mode: 'any' | 'all') => {
        const key = kind === 'context' ? 'contextMatchMode' : 'tagMatchMode';
        updateCriteria({ ...criteria, [key]: mode });
    };
    const clearFilters = () => {
        updateCriteria({});
        setSearchQuery('');
    };

    const [dropIndicator, setDropIndicator] = React.useState<BoardDropIndicator>(null);
    const [liveMessage, setLiveMessage] = React.useState('');
    const [composer, setComposer] = React.useState<BoardComposerState>(null);
    const [showOlderDone, setShowOlderDone] = React.useState(false);
    const [focusedCardId, setFocusedCardId] = React.useState<string | null>(null);
    const [dragWidth, setDragWidth] = React.useState<number | undefined>(undefined);
    const [menu, setMenu] = React.useState<
        | { kind: 'card'; task: Task; anchor: BoardMenuAnchor; trigger: HTMLElement }
        | { kind: 'column'; status: TaskStatus; anchor: BoardMenuAnchor; trigger: HTMLElement }
        | { kind: 'hidden'; anchor: BoardMenuAnchor; trigger: HTMLElement }
        | null
    >(null);
    const setEditingTaskId = useUiStore((state) => state.setEditingTaskId);
    const updateSettings = useTaskStore((state) => state.updateSettings);
    const scrollerRef = React.useRef<HTMLDivElement | null>(null);
    const hiddenButtonRef = React.useRef<HTMLSpanElement | null>(null);
    const [edges, setEdges] = React.useState({ left: false, right: false });
    const hiddenColumns = persistedViewState.hidden;
    const collapsedColumns = persistedViewState.collapsed;
    const prioritiesEnabled = resolveFeatureFlags(settings).priorities;
    const projectById = React.useMemo(() => {
        const map = new Map<string, BoardCardProject>();
        for (const project of projects) {
            if (project.deletedAt) continue;
            map.set(project.id, { title: project.title, color: getProjectAccentColor(project, areaById) });
        }
        return map;
    }, [projects, areaById]);

    const handleDragStart = (event: DragStartEvent) => {
        setActiveTask(event.active.data.current?.task || null);
        setDragWidth(event.active.rect.current.initial?.width);
        setDropIndicator(null);
    };


    const sortedTasks = React.useMemo(
        () => sortTasksBy(tasks.filter(t => !t.deletedAt), sortBy),
        [tasks, sortBy],
    );
    const areaFilteredTasks = React.useMemo(
        () => sortedTasks.filter((task) => isTaskVisibleInArea(task, visibility)),
        [sortedTasks, visibility]
    );
    const allTokens = React.useMemo(
        () => getUsedTaskTokens(areaFilteredTasks, (task) => [...(task.contexts || []), ...(task.tags || [])], { includeAncestors: true }),
        [areaFilteredTasks]
    );
    const criteriaFilteredTasks = React.useMemo(() => {
        const now = new Date();
        return hasFilters
            ? areaFilteredTasks.filter(createTaskFilterPredicate(criteria, { projects, now }))
            : areaFilteredTasks;
    }, [areaFilteredTasks, criteria, hasFilters, projects]);
    const normalizedSearchQuery = React.useMemo(() => searchQuery.trim().toLowerCase(), [searchQuery]);
    const filteredTasks = React.useMemo(() => {
        if (!normalizedSearchQuery) return criteriaFilteredTasks;
        return criteriaFilteredTasks.filter((task) => task.title.toLowerCase().includes(normalizedSearchQuery));
    }, [criteriaFilteredTasks, normalizedSearchQuery]);

    const sequencing = React.useMemo(() => getTaskSequencing(projects, sections), [projects, sections]);

    const sequentialProjectFirstTasks = React.useMemo(() => {
        perf.trackUseMemo();
        return perf.measure('sequentialProjectFirstTasks', () => {
            if (!computeSequential) return new Set<string>();
            if (!hasTaskSequences(sequencing)) return new Set<string>();


            const chainTasks = areaFilteredTasks.filter((task) => !task.deletedAt && isSequentialChainStatus(task.status));
            return getSequentialFirstTaskIds(chainTasks, sequencing.sequentialProjectIds, {
                sectionScopedProjectIds: sequencing.sectionScopedProjectIds,
                sequentialSectionKeys: sequencing.sequentialSectionKeys,
                sections,
            });
        });
    }, [areaFilteredTasks, computeSequential, sections, sequencing]);

    const sortByProjectOrder = React.useCallback(
        (items: Task[]) => [...items].sort(compareTasksByProjectThenOrder(projectOrderMap)),
        [projectOrderMap],
    );

    const getColumnTasks = React.useCallback((status: TaskStatus) => {
        let list = filteredTasks.filter((task) => task.status === status);
        if (status === 'next') {
            list = list.filter((task) => (
                !computeSequential || !isTaskSequenceBlocked(task, sequencing, sequentialProjectFirstTasks)
            ));
            if (sortBy === 'default') {
                list = sortByProjectOrder(list);
            }
        }
        return sortBy === 'default' ? sortTasksByBoardOrder(list) : list;
    }, [computeSequential, filteredTasks, sequencing, sequentialProjectFirstTasks, sortBy, sortByProjectOrder]);

    const getDoneSplit = React.useCallback(() => {
        const all = getColumnTasks('done');
        const cutoff = Date.now() - DONE_WINDOW_MS;
        const recent = all.filter((task) => {
            const when = safeParseDate(task.completedAt ?? task.updatedAt);
            return !when || when.getTime() >= cutoff;
        });
        return { all, recent, olderCount: all.length - recent.length };
    }, [getColumnTasks]);
    const getVisibleColumnTasks = React.useCallback((status: TaskStatus) => {
        if (status !== 'done') return getColumnTasks(status);
        const split = getDoneSplit();
        return showOlderDone ? split.all : split.recent;
    }, [getColumnTasks, getDoneSplit, showOlderDone]);

    const handleDragOver = (event: DragOverEvent) => {
        const { active, over } = event;
        if (!over || String(over.id) === String(active.id)) {
            setDropIndicator(null);
            return;
        }
        const overId = String(over.id);
        const activeId = String(active.id);
        const activeStatus = tasks.find((task) => task.id === activeId)?.status;
        if (columnIdSet.has(overId)) {
            const status = overId as TaskStatus;
            const ids = getColumnTasks(status).map((task) => task.id).filter((id) => id !== activeId);
            if (status === activeStatus) {
                // Dropping a card on its own column leaves it where it is.
                setDropIndicator(null);
                return;
            }
            setDropIndicator({ columnId: status, taskId: ids[ids.length - 1] ?? null, position: 'after' });
            return;
        }
        const overStatus = tasks.find((task) => task.id === overId)?.status;
        if (!overStatus) {
            setDropIndicator(null);
            return;
        }
        const columnIds = getColumnTasks(overStatus).map((task) => task.id);
        if (overStatus === activeStatus) {
            if (sortBy !== 'default') {
                setDropIndicator(null);
                return;
            }
            const position = columnIds.indexOf(activeId) < columnIds.indexOf(overId) ? 'after' : 'before';
            setDropIndicator({ columnId: overStatus, taskId: overId, position });
            return;
        }
        if (sortBy !== 'default') {
            setDropIndicator({ columnId: overStatus, taskId: columnIds[columnIds.length - 1] ?? null, position: 'after' });
            return;
        }
        setDropIndicator({ columnId: overStatus, taskId: overId, position: 'before' });
    };

    const columnIdSet = React.useMemo(
        () => new Set<string>(getColumns(t).map((column) => column.id)),
        [t]
    );


    const visibleColumnIds = React.useMemo(
        () => COLUMN_STATUSES.filter((status) => !hiddenColumns.includes(status)),
        [hiddenColumns],
    );
    const visibleTasks = React.useMemo(
        () => visibleColumnIds.flatMap((status) => (
            collapsedColumns.includes(status) ? [] : getVisibleColumnTasks(status)
        )),
        [collapsedColumns, getVisibleColumnTasks, visibleColumnIds],
    );
    const tabbableId = React.useMemo(() => (
        focusedCardId && visibleTasks.some((task) => task.id === focusedCardId)
            ? focusedCardId
            : visibleTasks[0]?.id ?? null
    ), [focusedCardId, visibleTasks]);
    React.useEffect(() => {
        if (!computeSequential || sequentialPhase.current !== 'fired') return;
        sequentialPhase.current = 'committed';
        recordRendererActivity(sequentialActivity.current, 'committed', {
            filteredCount: filteredTasks.length, visibleCount: visibleTasks.length,
            sequentialProjectCount: sequencing.sequentialProjectIds.size + sequencing.sequentialSectionKeys.size,
            sequentialResultCount: sequentialProjectFirstTasks.size,
        });
    }, [computeSequential, filteredTasks, visibleTasks, sequencing, sequentialProjectFirstTasks]);
    const [selectedTaskIndex, setSelectedTaskIndex] = React.useState(0);
    useTaskListScope({
        getTasks: () => visibleTasks,
        getSelectedIndex: () => selectedTaskIndex,
        setSelectedIndex: setSelectedTaskIndex,
        t,
    });


    React.useLayoutEffect(() => {
        const scroller = scrollerRef.current;
        if (!scroller) return;
        scroller.scrollLeft = 0;
        const frame = window.requestAnimationFrame(() => { scroller.scrollLeft = 0; });
        return () => window.cancelAnimationFrame(frame);
    }, []);
    const updateEdges = React.useCallback(() => {
        const scroller = scrollerRef.current;
        if (!scroller) return;
        const left = scroller.scrollLeft > 4;
        const right = scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 4;
        setEdges((current) => (current.left === left && current.right === right ? current : { left, right }));
    }, []);
    React.useEffect(() => {
        updateEdges();
        const scroller = scrollerRef.current;
        if (!scroller || typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(updateEdges);
        observer.observe(scroller);
        if (scroller.firstElementChild) observer.observe(scroller.firstElementChild);
        return () => observer.disconnect();
    }, [updateEdges, hiddenColumns, collapsedColumns]);

    const collisionDetection = React.useCallback<CollisionDetection>((args) => {
        const pointerHits = pointerWithin(args);
        const intersections = pointerHits.length > 0 ? pointerHits : rectIntersection(args);
        const overId = getFirstCollision(intersections, 'id');
        if (overId == null) return closestCorners(args);

        if (columnIdSet.has(String(overId))) {
            const cardIds = new Set(getColumnTasks(overId as TaskStatus).map((task) => task.id));
            const columnCards = args.droppableContainers.filter((container) => cardIds.has(String(container.id)));
            if (columnCards.length > 0) {
                const closest = closestCenter({ ...args, droppableContainers: columnCards });
                if (closest.length > 0) return closest;
            }
        }
        return [{ id: overId }];
    }, [columnIdSet, getColumnTasks]);

    const rememberPreviousStatus = (taskId: string, status: TaskStatus) => {
        if (status === 'done' || status === 'archived') return;
        setPersistedViewState((current) => {
            const entries = Object.entries({ ...current.previousStatus, [taskId]: status });
            return { ...current, previousStatus: Object.fromEntries(entries.slice(-MAX_PREVIOUS_STATUSES)) };
        });
    };
    const moveTaskTracked = (taskId: string, status: TaskStatus) => {
        const current = tasks.find((candidate) => candidate.id === taskId);
        if (current && status === 'done' && current.status !== 'done') rememberPreviousStatus(taskId, current.status);
        return moveTask(taskId, status);
    };

    const applyBoardAction = (action: BoardDragEndAction) => {
        if (action.type === 'move') {
            void moveTaskTracked(action.taskId, action.status);
        } else if (action.type === 'reorder') {
            void reorderBoardTasks(action.status, action.orderedIds);
        } else if (action.type === 'moveAndReorder') {
            void (async () => {
                await moveTaskTracked(action.taskId, action.status);
                await reorderBoardTasks(action.status, action.orderedIds);
            })();
        }
    };

    const focusCard = (taskId: string) => {
        setFocusedCardId(taskId);
        window.setTimeout(() => {
            document.querySelector<HTMLElement>(`[data-board-card-id="${CSS.escape(taskId)}"] [data-board-card]`)?.focus();
        }, 0);
    };

    const handleKeyboardMove = (task: Task, direction: BoardKeyboardDirection, edge = false) => {
        const columnTaskIds = getColumnTasks(task.status).map((candidate) => candidate.id);
        const action = edge && (direction === 'up' || direction === 'down')
            ? resolveBoardEdgeMove(task.id, task.status, direction === 'up' ? 'top' : 'bottom', columnTaskIds, sortBy === 'default')
            : resolveBoardKeyboardMove({
                taskId: task.id,
                direction,
                columnIds: visibleColumnIds,
                status: task.status,
                columnTaskIds,
                canReorder: sortBy === 'default',
            });
        if (action.type === 'none') return;
        applyBoardAction(action);
        const targetStatus = action.type === 'move' ? action.status : task.status;
        const targetLabel = COLUMNS.find((column) => column.id === targetStatus)?.label ?? '';
        setLiveMessage(`${task.title}: ${targetLabel}`);
        focusCard(task.id);
    };

    const handleNavigate = (task: Task, direction: BoardKeyboardDirection) => {
        if (activeTask) return;
        const columns = visibleColumnIds.filter((status) => !collapsedColumns.includes(status));
        const columnIndex = columns.indexOf(task.status);
        if (columnIndex < 0) return;
        const list = getVisibleColumnTasks(task.status);
        const index = list.findIndex((candidate) => candidate.id === task.id);
        if (direction === 'up' || direction === 'down') {
            const next = list[index + (direction === 'up' ? -1 : 1)];
            if (next) focusCard(next.id);
            return;
        }
        const step = direction === 'left' ? -1 : 1;
        for (let i = columnIndex + step; i >= 0 && i < columns.length; i += step) {
            const candidates = getVisibleColumnTasks(columns[i]);
            if (candidates.length > 0) {
                focusCard(candidates[Math.min(index, candidates.length - 1)].id);
                return;
            }
        }
    };

    const resolvePreviousStatus = (task: Task): TaskStatus => {
        const previous = persistedViewState.previousStatus[task.id];
        return previous && previous !== 'done' && previous !== 'archived' ? previous : 'next';
    };
    const handleToggleDone = (task: Task) => {
        if (task.status === 'done') {
            void moveTask(task.id, resolvePreviousStatus(task));
        } else {
            void moveTaskTracked(task.id, 'done');
        }
    };

    const reorderToEdge = (task: Task, edge: 'top' | 'bottom') => {
        const action = resolveBoardEdgeMove(
            task.id, task.status, edge, getColumnTasks(task.status).map((candidate) => candidate.id), sortBy === 'default',
        );
        applyBoardAction(action);
    };

    const toggleCollapsed = (status: TaskStatus) => {
        setPersistedViewState((current) => ({
            ...current,
            collapsed: current.collapsed.includes(status)
                ? current.collapsed.filter((item) => item !== status)
                : [...current.collapsed, status],
        }));
        setComposer((current) => (current?.status === status ? null : current));
    };
    const hideColumn = (status: TaskStatus) => {
        setPersistedViewState((current) => ({
            ...current,
            hidden: current.hidden.includes(status) ? current.hidden : [...current.hidden, status],
        }));
        setComposer((current) => (current?.status === status ? null : current));
    };
    const showColumn = (status: TaskStatus) => {
        setPersistedViewState((current) => ({ ...current, hidden: current.hidden.filter((item) => item !== status) }));
    };

    const submitCard = async (status: TaskStatus, title: string, position: 'top' | 'bottom') => {
        const state = useTaskStore.getState();
        const parsed = parseQuickAdd(title, state.projects, new Date(), state.areas, buildQuickAddParseOptions(state.settings, state));
        parsed.props = { ...parsed.props, status };
        const existingIds = getColumnTasks(status).map((task) => task.id);
        const result = await executeCaptureTransaction(
            { parsed, rawInput: title, fallbackTitle: title, projects: state.projects },
            { addProject: state.addProject, addTask: state.addTask },
        );
        if (!result.success) {
            useUiStore.getState().showToast(tFallback(t, 'task.addFailed', 'Failed to add task'), 'error');
            return;
        }
        if (position === 'top' && sortBy === 'default' && result.createdTaskId) {
            await reorderBoardTasks(status, [result.createdTaskId, ...existingIds]);
        }
    };

    const archiveDone = () => {
        const ids = getColumnTasks('done').map((task) => task.id);
        if (ids.length === 0) return;
        void Promise.all(ids.map((id) => useTaskStore.getState().updateTask(id, { status: 'archived' })));
        showUndoToast(
            tFallback(t, 'board.doneArchived', 'Done tasks archived'),
            () => { void Promise.all(ids.map((id) => useTaskStore.getState().updateTask(id, { status: 'done' }))); },
            t,
        );
    };

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        setActiveTask(null);
        setDropIndicator(null);
        if (!over) return;

        const currentTask = tasks.find((task) => task.id === active.id);
        if (activeTask && currentTask && currentTask.status !== activeTask.status) return;

        const overTask = over.data.current?.task as Task | undefined;
        const action = resolveBoardDragEnd({
            activeId: String(active.id),
            overId: String(over.id),
            columnIds: COLUMNS.map((column) => column.id),
            activeStatus: currentTask?.status,
            overStatus: overTask?.status,
            columnTaskIds: currentTask ? getColumnTasks(currentTask.status).map((task) => task.id) : [],
            overColumnTaskIds: overTask ? getColumnTasks(overTask.status).map((task) => task.id) : undefined,
            canReorder: sortBy === 'default',
        });
        applyBoardAction(action);
    };

    const resolveText = React.useCallback((key: string, fallback: string) => {
        return translateWithFallback(t, key, fallback);
    }, [t]);
    const searchTasksLabel = resolveText('filters.searchTasks', 'Search task titles');
    const activeFilterChips: DesktopActiveFilterChip[] = [];
    const normalizedSearch = searchQuery.trim();
    if (normalizedSearch) {
        activeFilterChips.push({
            id: 'search',
            label: `${searchTasksLabel}: ${normalizedSearch}`,
            onRemove: () => setSearchQuery(''),
        });
    }
    buildActiveFilterChips(criteria, {
        t,
        resolveText,
        getProject: (projectId) => projects.find((candidate) => candidate.id === projectId),
        getAreaColor: (areaId) => areaById.get(areaId)?.color,
        getAreaLabel: (areaId) => areaById.get(areaId)?.name,
    }, { duePresetAsBasic: true, metadataAsAdvanced: true }).forEach((chip) => {
        activeFilterChips.push({
            ...chip,
            onRemove: () => updateCriteria(removeFilterChipFromCriteria(criteria, chip.id)),
        });
    });

    const getEmptyState = (status: TaskStatus) => {
        switch (status) {
            case 'inbox':
                return { body: resolveText('board.emptyInbox', 'Inbox zero. Capture something.') };
            case 'next':
                return { body: resolveText('board.emptyNext', 'Nothing next. Pull from Inbox or Someday.') };
            case 'waiting':
                return { body: resolveText('board.emptyWaiting', 'Nothing waiting on anyone.') };
            case 'someday':
                return { body: resolveText('board.emptySomeday', 'Park ideas here.') };
            default:
                return { body: resolveText('board.emptyDone', 'Finished tasks land here.') };
        }
    };

    const columnLabels = (olderCount: number): BoardColumnLabels => ({
        addCard: tFallback(t, 'board.addCard', 'Add a card'),
        addCardSubmit: tFallback(t, 'board.addCardSubmit', 'Add card'),
        cardPlaceholder: tFallback(t, 'board.cardPlaceholder', 'Enter a title for this card'),
        cancel: tFallback(t, 'common.cancel', 'Cancel'),
        columnMenu: tFallback(t, 'board.columnMenu', 'Column options'),
        cardMenu: tFallback(t, 'board.cardMenu', 'Card actions'),
        expand: tFallback(t, 'board.expandColumn', 'Expand column'),
        showOlder: tFallback(t, 'board.showOlder', 'Show older ({{count}})').replace(/\{\{\s*count\s*\}\}/g, String(olderCount)),
        hideOlder: tFallback(t, 'board.hideOlder', 'Hide older'),
        drag: tFallback(t, 'board.dragTask', 'Drag task'),
    });

    const closeMenu = () => {
        const trigger = menu?.trigger;
        setMenu(null);
        trigger?.focus();
    };

    const buildMenuItems = (): BoardMenuItem[] => {
        if (!menu) return [];
        if (menu.kind === 'hidden') {
            return COLUMNS.filter((column) => hiddenColumns.includes(column.id)).map((column) => ({
                id: `show-${column.id}`,
                label: `${tFallback(t, 'board.showColumn', 'Show column')}: ${column.label}`,
                onSelect: () => showColumn(column.id),
            }));
        }
        if (menu.kind === 'column') {
            const status = menu.status;
            const items: BoardMenuItem[] = [
                { id: 'add-top', label: tFallback(t, 'board.addCardTop', 'Add a card at the top'), onSelect: () => setComposer({ status, position: 'top' }) },
                { type: 'separator', id: 'sep-sort' },
                { type: 'heading', id: 'sort-heading', label: tFallback(t, 'board.sortBy', 'Sort by') },
                ...([
                    ['default', tFallback(t, 'board.sortManual', 'Manual')],
                    ['due', tFallback(t, 'board.sortDue', 'Due date')],
                    ['priority', tFallback(t, 'board.sortPriority', 'Priority')],
                    ['title', tFallback(t, 'board.sortTitle', 'Title')],
                ] as const).map(([value, label]) => ({
                    id: `sort-${value}`,
                    label,
                    checked: sortBy === value,
                    onSelect: () => { void updateSettings({ taskSortBy: value }); },
                })),
                { type: 'separator', id: 'sep-view' },
                { id: 'collapse', label: tFallback(t, 'board.collapseColumn', 'Collapse column'), shortcut: '\\', onSelect: () => toggleCollapsed(status) },
                { id: 'hide', label: tFallback(t, 'board.hideColumn', 'Hide column'), onSelect: () => hideColumn(status) },
            ];
            if (status === 'done') {
                items.push(
                    { type: 'separator', id: 'sep-archive' },
                    {
                        id: 'archive-done',
                        label: tFallback(t, 'board.archiveDone', 'Archive all done'),
                        disabled: getColumnTasks('done').length === 0,
                        onSelect: archiveDone,
                    },
                );
            }
            return items;
        }
        const task = menu.task;
        const ids = getColumnTasks(task.status).map((candidate) => candidate.id);
        const index = ids.indexOf(task.id);
        const canReorder = sortBy === 'default';
        return [
            { id: 'open', label: tFallback(t, 'board.openCard', 'Open'), onSelect: () => setEditingTaskId(task.id) },
            { type: 'heading', id: 'move-heading', label: tFallback(t, 'board.moveTo', 'Move to') },
            ...COLUMNS.map((column) => ({
                id: `move-${column.id}`,
                label: column.label,
                disabled: column.id === task.status,
                onSelect: () => {
                    void moveTaskTracked(task.id, column.id);
                    setLiveMessage(`${task.title}: ${column.label}`);
                },
            })),
            { type: 'separator', id: 'sep-order' },
            { id: 'move-top', label: tFallback(t, 'board.moveToTop', 'Move to top'), disabled: !canReorder || index <= 0, onSelect: () => reorderToEdge(task, 'top') },
            { id: 'move-bottom', label: tFallback(t, 'board.moveToBottom', 'Move to bottom'), disabled: !canReorder || index < 0 || index === ids.length - 1, onSelect: () => reorderToEdge(task, 'bottom') },
            { type: 'separator', id: 'sep-done' },
            {
                id: 'toggle-done',
                label: task.status === 'done' ? tFallback(t, 'status.reopen', 'Reopen') : tFallback(t, 'task.markDone', 'Mark done'),
                onSelect: () => handleToggleDone(task),
            },
            { id: 'delete', label: tFallback(t, 'common.delete', 'Delete'), danger: true, onSelect: () => deleteTaskWithUndo(task.id, { t }) },
        ];
    };
    const menuLabel = menu?.kind === 'card'
        ? tFallback(t, 'board.cardMenu', 'Card actions')
        : menu?.kind === 'hidden'
            ? tFallback(t, 'board.hiddenColumns', 'Hidden columns')
            : tFallback(t, 'board.columnMenu', 'Column options');

    return (
        <ErrorBoundary>
            <div className="flex h-full min-h-0 flex-col">
                <div className="shrink-0 px-4 pb-4">
                    <ViewHeader
                        title={t('board.title')}
                        count={`${filteredTasks.length} ${t('common.tasks')}`}
                        actions={
                        <div className="flex items-center gap-2">
                            {hiddenColumns.length > 0 ? (
                                <span ref={hiddenButtonRef} className="inline-flex">
                                    <ToolbarButton
                                        onClick={() => {
                                            const trigger = hiddenButtonRef.current?.querySelector('button');
                                            if (!trigger) return;
                                            const rect = trigger.getBoundingClientRect();
                                            setMenu({ kind: 'hidden', anchor: { x: rect.left, y: rect.top, width: rect.width, height: rect.height }, trigger });
                                        }}
                                        icon={<Columns3 className="h-3.5 w-3.5" aria-hidden="true" />}
                                    >
                                        {`${tFallback(t, 'board.hiddenColumns', 'Hidden columns')} (${hiddenColumns.length})`}
                                    </ToolbarButton>
                                </span>
                            ) : null}
                            <ToolbarButton
                                active={showFiltersPanel || hasBoardFilters}
                                onClick={() => setPersistedViewState((current) => ({ ...current, filtersOpen: !current.filtersOpen }))}
                                aria-expanded={showFiltersPanel}
                                aria-controls="board-filters-panel"
                                icon={<Filter className="h-3.5 w-3.5" aria-hidden="true" />}
                            >
                                {t('filters.label')}
                            </ToolbarButton>
                        </div>
                        }
                    />
                    <div className="mt-3">
                        <input
                            type="text"
                            data-view-filter-input
                            placeholder={searchTasksLabel}
                            aria-label={searchTasksLabel}
                            value={searchQuery}
                            onChange={(event) => setSearchQuery(event.target.value)}
                            className={VIEW_FILTER_INPUT}
                        />
                    </div>
                    {sortBy !== 'default' && (
                        <p className="mt-2 text-xs text-muted-foreground">
                            {resolveText('board.reorderFollowsSort', 'Ordering follows the selected sort. Switch to default sort to reorder cards.')}
                        </p>
                    )}

                    {(showFiltersPanel || hasBoardFilters) && (
                        <BoardFiltersPanel
                            activeFilterChips={activeFilterChips}
                            allTokens={allTokens}


                            contextMatchMode={criteria.contextMatchMode ?? 'any'}
                            duePresets={DUE_DATE_PRESETS}
                            excludedTokens={excludedTokens}
                            hasFilters={hasBoardFilters}
                            onClearFilters={clearFilters}
                            onClose={() => setPersistedViewState((current) => ({ ...current, filtersOpen: false }))}
                            onContextMatchModeChange={(mode) => setMatchMode('context', mode)}
                            onTagMatchModeChange={(mode) => setMatchMode('tag', mode)}
                            onToggleDuePreset={(preset) => toggleDuePreset(preset as DueDatePreset)}
                            onToggleProject={toggleProjectFilter}
                            onToggleToken={toggleToken}
                            projectOptions={sortedProjects.map((project) => ({
                                id: project.id,
                                title: project.title,
                                dotColor: getProjectAccentColor(project, areaById),
                            }))}
                            selectedDuePreset={selectedDuePreset}
                            selectedProjectIds={selectedProjectIds}
                            selectedTokens={selectedTokens}
                            showFiltersPanel={showFiltersPanel}
                            tagMatchMode={criteria.tagMatchMode ?? 'any'}
                            t={t}
                        />
                    )}
                </div>

                <div className="relative min-h-0 flex-1">
                <div
                    ref={scrollerRef}
                    data-board-scroller
                    onScroll={updateEdges}
                    className="h-full overflow-x-auto overflow-y-hidden overscroll-x-contain px-4 pb-4 [container-type:inline-size] [scroll-padding-inline:1rem] [scroll-snap-type:x_proximity] [scrollbar-width:thin]"
                >
                    <div data-board-columns className="flex h-full items-start gap-3">
                        <DndContext
                            onDragStart={handleDragStart}
                            onDragOver={handleDragOver}
                            onDragEnd={handleDragEnd}
                            onDragCancel={() => { setActiveTask(null); setDropIndicator(null); }}
                            collisionDetection={collisionDetection}
                            sensors={sensors}
                            autoScroll={{ threshold: { x: 0.12, y: 0.15 }, acceleration: 12 }}
                        >
                            {COLUMNS.filter((col) => !hiddenColumns.includes(col.id)).map((col) => {
                                const done = col.id === 'done';
                                const split = done ? getDoneSplit() : null;
                                const visible = getVisibleColumnTasks(col.id);
                                return (
                                    <BoardColumn
                                        key={col.id}
                                        id={col.id}
                                        label={col.label}
                                        tasks={visible}
                                        totalCount={split ? split.all.length : visible.length}
                                        olderCount={split?.olderCount ?? 0}
                                        showOlder={showOlderDone}
                                        onToggleOlder={() => setShowOlderDone((current) => !current)}
                                        emptyState={getEmptyState(col.id)}
                                        labels={columnLabels(split?.olderCount ?? 0)}
                                        compact={isDense}
                                        collapsed={collapsedColumns.includes(col.id)}
                                        showPriority={prioritiesEnabled}
                                        projectById={projectById}
                                        dropIndicator={dropIndicator}
                                        composer={composer}
                                        tabbableId={tabbableId}
                                        t={t}
                                        onOpenComposer={(status, position) => setComposer({ status, position })}
                                        onCloseComposer={() => setComposer(null)}
                                        onSubmitCard={submitCard}
                                        onOpenColumnMenu={(status, anchor, trigger) => setMenu({ kind: 'column', status, anchor, trigger })}
                                        onExpand={toggleCollapsed}
                                        onToggleDone={handleToggleDone}
                                        onKeyboardMove={handleKeyboardMove}
                                        onNavigate={handleNavigate}
                                        onFocusCard={(task) => setFocusedCardId(task.id)}
                                        onCardMenu={(task, anchor, trigger) => setMenu({ kind: 'card', task, anchor, trigger })}
                                        onColumnShortcut={(task, key) => {
                                            if (key === 'collapse') toggleCollapsed(task.status);
                                            else setComposer({ status: task.status, position: 'bottom' });
                                        }}
                                    />
                                );
                            })}
                            <div aria-hidden="true" className="w-1 shrink-0" />

                            <DragOverlay dropAnimation={canAnimate() ? BOARD_DROP_ANIMATION : null}>
                                {activeTask ? (
                                    <BoardCardOverlay
                                        task={activeTask}
                                        width={dragWidth}
                                        project={activeTask.projectId ? projectById.get(activeTask.projectId) : undefined}
                                        showPriority={prioritiesEnabled}
                                        t={t}
                                        compact={isDense}
                                    />
                                ) : null}
                            </DragOverlay>
                        </DndContext>
                    </div>
                </div>
                {edges.left ? <div aria-hidden="true" data-board-fade="left" className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-background to-transparent" /> : null}
                {edges.right ? <div aria-hidden="true" data-board-fade="right" className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-background to-transparent" /> : null}
                </div>
                {menu ? (
                    <BoardMenu label={menuLabel} anchor={menu.anchor} items={buildMenuItems()} onClose={closeMenu} />
                ) : null}
                <div role="status" aria-live="polite" className="sr-only">{liveMessage}</div>
            </div>
        </ErrorBoundary>
    );
}
