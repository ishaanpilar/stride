import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import {
    buildQuickAddParseOptions,
    executeCaptureTransaction,
    flushPendingSave,
    formatI18nTemplate,
    getMenuBarReorderIds,
    isMenuBarTaskReorderable,
    moveIdByOffset,
    moveIdToTop,
    parseQuickAdd,
    resolveFeatureFlags,
    retainCompletedInSections,
    selectMenuBarPanelTabs,
    translateWithFallback,
    undoTaskCompletion,
    useTaskStore,
    type MenuBarReorderKind,
    type SectionMembership,
    type Task,
    type TaskStatus,
} from '@stride/core';
import { CalendarDays, ExternalLink, Inbox, Lock, ListChecks, Plus, Power, Send, Sparkles, Sun } from 'lucide-react';
import { useLanguage } from '../contexts/language-context';
import { readCachedDailyBriefing } from '../lib/daily-briefing-service';
import {
    MENUBAR_PANEL_SHOWN_EVENT,
    hideMenuBarPanel,
    lockFromMenuBarPanel,
    notifyMainWindow,
    openMainFromMenuBarPanel,
    quitFromMenuBarPanel,
} from '../lib/menubar-panel-window';
import { QUICK_ADD_SAVED_EVENT } from '../lib/quick-add-saved-event';
import { reportError } from '../lib/report-error';
import { useCompletionRetention } from '../lib/completion-retention';
import {
    commitBoardOrder,
    MANUAL_ORDER_KEYS,
    restoreBoardOrder,
    snapshotBoardOrder,
    statusesOf,
    switchedToManualOrderMessage,
    useManualOrderMode,
    readManualOrder as readManualFlag,
    writeManualOrder,
    type BoardOrderSnapshot,
} from '../lib/manual-order';
import { isTauriRuntime } from '../lib/runtime';
import { invokeNative } from '../lib/tauri-invoke';
import { cn } from '../lib/utils';
import { PanelCalendarStrip } from './menubar/PanelCalendarStrip';
import { PanelPomodoro } from './menubar/PanelPomodoro';
import { PanelDragGhost } from './menubar/PanelDragGhost';
import { PanelTaskRow, type PanelMoveAction, type PanelRowReorder, type PanelRowTone } from './menubar/PanelTaskRow';
import { idsAreEqual } from './menubar/panel-reorder';
import { usePanelReorder, type PanelReorderChange } from './menubar/usePanelReorder';

const UNDO_VISIBLE_MS = 6000;
const NOTICE_VISIBLE_MS = 2200;
const COMPLETE_ANIMATION_MS = 240;
const TAB_STORAGE_KEY = 'stride-menubar-tab';

type PanelTab = 'today' | 'upcoming' | 'inbox' | 'next';
const TAB_ORDER: PanelTab[] = ['today', 'upcoming', 'inbox', 'next'];

type UndoState = { taskId: string; title: string; previousStatus: TaskStatus; wasFocusedToday: boolean };
type OrderUndoState = { viewKey: string; snapshot: BoardOrderSnapshot };
type PanelReorderGroup = { key: string; kind: MenuBarReorderKind };

const manualOrderKeyForGroup = (groupKey: string): string | null => {
    if (groupKey.startsWith('today:')) return MANUAL_ORDER_KEYS.today;
    if (groupKey.startsWith('upcoming:')) return MANUAL_ORDER_KEYS.upcoming;
    if (groupKey === 'board:inbox') return MANUAL_ORDER_KEYS.inbox;
    if (groupKey === 'board:next') return MANUAL_ORDER_KEYS.next;
    return null;
};

function readStoredTab(): PanelTab {
    try {
        const value = window.localStorage.getItem(TAB_STORAGE_KEY);
        if (value && (TAB_ORDER as string[]).includes(value)) return value as PanelTab;
    } catch {
        // Storage can be unavailable; fall back to Today.
    }
    return 'today';
}

function storeTab(tab: PanelTab): void {
    try {
        window.localStorage.setItem(TAB_STORAGE_KEY, tab);
    } catch {
        // Ignore.
    }
}

const prefersReducedMotion = (): boolean => (
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
);

async function syncMainWindow(): Promise<void> {
    if (!isTauriRuntime()) return;
    await flushPendingSave().catch((error) => reportError('Failed to save menu bar panel change', error));
    await notifyMainWindow(QUICK_ADD_SAVED_EVENT, { savedAt: new Date().toISOString() })
        .catch((error) => reportError('Failed to notify main window from menu bar panel', error));
}

async function refreshData(): Promise<void> {
    await useTaskStore.getState().fetchData({ silent: true })
        .catch((error) => reportError('Failed to refresh menu bar panel data', error));
}

function SectionHeader({ title, count }: { title: string; count?: number }) {
    return (
        <h2 className="flex items-baseline gap-1.5 px-2.5 pb-1 pt-2.5 text-xs font-semibold text-muted-foreground">
            {title}
            {count !== undefined && <span className="font-medium tabular-nums opacity-70">{count}</span>}
        </h2>
    );
}

function IconButton({ label, onClick, children, danger }: { label: string; onClick: () => void; children: ReactNode; danger?: boolean }) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={label}
            title={label}
            className={cn(
                'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-muted-foreground transition-colors',
                'hover:bg-foreground/[0.08] hover:text-foreground active:bg-foreground/[0.12]',
                'focus-ring',
                danger && 'hover:bg-destructive/10 hover:text-danger-text',
            )}
        >
            {children}
        </button>
    );
}

export function MenuBarPanel() {
    const { t, language } = useLanguage();
    const tr = useCallback((key: string, fallback: string) => translateWithFallback(t, key, fallback), [t]);
    const tasks = useTaskStore((state) => state.tasks);
    const projects = useTaskStore((state) => state.projects);
    const pomodoroEnabled = useTaskStore((state) => resolveFeatureFlags(state.settings).pomodoro);
    const [locked, setLocked] = useState(false);
    const [lockEnabled, setLockEnabled] = useState(false);
    const [dayTick, setDayTick] = useState(0);
    const [undo, setUndo] = useState<UndoState | null>(null);
    const [orderUndo, setOrderUndo] = useState<OrderUndoState | null>(null);
    const orderUndoTimer = useRef<number | null>(null);
    const [manualToday] = useManualOrderMode(MANUAL_ORDER_KEYS.today);
    const [manualUpcoming] = useManualOrderMode(MANUAL_ORDER_KEYS.upcoming);
    const [manualInbox] = useManualOrderMode(MANUAL_ORDER_KEYS.inbox);
    const [manualNext] = useManualOrderMode(MANUAL_ORDER_KEYS.next);
    const [quickAdd, setQuickAdd] = useState('');
    const [ask, setAsk] = useState('');
    const [message, setMessage] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [tab, setTab] = useState<PanelTab>(readStoredTab);
    const [reorderAnnouncement, setReorderAnnouncement] = useState('');
    const [completing, setCompleting] = useState<ReadonlySet<string>>(new Set());
    const undoTimer = useRef<number | null>(null);
    const noticeTimer = useRef<number | null>(null);
    const captureRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    const focusCapture = useCallback(() => {
        window.setTimeout(() => captureRef.current?.focus(), 30);
    }, []);

    const refreshAll = useCallback(async () => {
        setDayTick((value) => value + 1);
        if (isTauriRuntime()) {
            try {
                const state = await invokeNative<{ locked?: boolean; enabled?: boolean }>('get_app_lock_state');
                setLocked(state?.locked === true);
                setLockEnabled(state?.enabled === true);
            } catch (error) {
                // If the lock state is unknown, fail closed: do not show task titles.
                setLocked(true);
                reportError('Failed to read app lock state', error);
            }
        }
        await refreshData();
    }, []);

    useEffect(() => {
        void refreshAll();
        focusCapture();
        const onFocus = () => { void refreshAll(); focusCapture(); };
        window.addEventListener('focus', onFocus);
        let unlisten: (() => void) | undefined;
        let disposed = false;
        if (isTauriRuntime()) {
            void import('@tauri-apps/api/event').then(async ({ listen }) => {
                const off = await listen(MENUBAR_PANEL_SHOWN_EVENT, () => {
                    setMessage(null);
                    setTab(readStoredTab());
                    void refreshAll();
                    focusCapture();
                });
                // Same event the panel sends the main window after a change: anything that writes tasks
                // (a reorder in the main window included) asks every window to re-read the data file.
                const offSaved = await listen(QUICK_ADD_SAVED_EVENT, () => { void refreshAll(); });
                if (disposed) { off(); offSaved(); } else { unlisten = () => { off(); offSaved(); }; }
            });
        }
        return () => {
            disposed = true;
            window.removeEventListener('focus', onFocus);
            unlisten?.();
        };
    }, [refreshAll, focusCapture]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented) return;
            event.preventDefault();
            if (isTauriRuntime()) void hideMenuBarPanel().catch((error) => reportError('Failed to hide menu bar panel', error));
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, []);

    useEffect(() => () => {
        if (undoTimer.current !== null) window.clearTimeout(undoTimer.current);
        if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
        if (orderUndoTimer.current !== null) window.clearTimeout(orderUndoTimer.current);
    }, []);

    const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
    const baseView = useMemo(() => {
        void dayTick;
        return selectMenuBarPanelTabs(tasks, {
            projects,
            now: new Date(),
            manualOrder: { today: manualToday, upcoming: manualUpcoming, inbox: manualInbox, next: manualNext },
        });
    }, [tasks, projects, dayTick, manualToday, manualUpcoming, manualInbox, manualNext]);
    // Completion rule: a task ticked done here stays in its list, struck through, and drops to the bottom of
    // that list after the settle delay (see core task-completion-order.ts). Counts stay open-task counts.
    const { retained: sessionCompletions, settledIds: settledCompletionIds } = useCompletionRetention();
    const tasksById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
    const sectionMembershipRef = useRef<SectionMembership>(new Map());
    const view = useMemo(() => {
        if (sessionCompletions.size === 0 && sectionMembershipRef.current.size === 0) return baseView;
        const lists: Record<string, Task[]> = {
            overdue: baseView.overdue,
            today: baseView.today,
            inbox: baseView.inbox,
            next: baseView.next,
        };
        baseView.upcoming.forEach((day) => { lists[`upcoming:${day.key}`] = day.tasks; });
        const merged = retainCompletedInSections(lists, sectionMembershipRef.current, sessionCompletions, settledCompletionIds, (id) => tasksById.get(id));
        return {
            ...baseView,
            overdue: merged.overdue,
            today: merged.today,
            inbox: merged.inbox,
            next: merged.next,
            upcoming: baseView.upcoming.map((day) => ({ ...day, tasks: merged[`upcoming:${day.key}`] ?? day.tasks })),
        };
    }, [baseView, sessionCompletions, settledCompletionIds, tasksById]);
    const briefing = useMemo(() => {
        void dayTick;
        return readCachedDailyBriefing()?.briefing ?? null;
    }, [dayTick]);

    const dateLabel = useMemo(() => {
        void dayTick;
        try {
            return new Date().toLocaleDateString(language, { weekday: 'long', day: 'numeric', month: 'short' });
        } catch {
            return new Date().toDateString();
        }
    }, [dayTick, language]);

    const dayHeading = useCallback((date: Date): string => {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        if (date.toDateString() === tomorrow.toDateString()) return tr('menubar.tomorrow', 'Tomorrow');
        try {
            return date.toLocaleDateString(language, { weekday: 'long', day: 'numeric', month: 'short' });
        } catch {
            return date.toDateString();
        }
    }, [language, tr]);

    const selectTab = useCallback((next: PanelTab) => {
        setTab(next);
        storeTab(next);
    }, []);

    const showNotice = useCallback((text: string) => {
        setNotice(text);
        if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
        noticeTimer.current = window.setTimeout(() => setNotice(null), NOTICE_VISIBLE_MS);
    }, []);

    const finishComplete = useCallback(async (task: Task) => {
        const previousStatus = task.status;
        const wasFocusedToday = task.isFocusedToday === true;
        try {
            const result = await useTaskStore.getState().moveTask(task.id, 'done');
            if (result && result.success === false) throw new Error(result.error || 'Failed to complete task');
            setUndo({ taskId: task.id, title: task.title, previousStatus, wasFocusedToday });
            if (undoTimer.current !== null) window.clearTimeout(undoTimer.current);
            undoTimer.current = window.setTimeout(() => setUndo(null), UNDO_VISIBLE_MS);
            await syncMainWindow();
        } catch (error) {
            setMessage(error instanceof Error ? error.message : 'Failed to complete task');
            reportError('Failed to complete task from menu bar panel', error);
        } finally {
            setCompleting((current) => {
                const next = new Set(current);
                next.delete(task.id);
                return next;
            });
        }
    }, []);

    const completeTask = useCallback((task: Task) => {
        if (task.status === 'done') {
            // Ticked again: restore it to where it came from.
            const previousStatus = sessionCompletions.get(task.id)?.previousStatus ?? 'next';
            void undoTaskCompletion(task.id, previousStatus, false)
                .then(() => syncMainWindow())
                .catch((error) => reportError('Failed to restore task from menu bar panel', error));
            return;
        }
        if (completing.has(task.id)) return;
        setCompleting((current) => new Set(current).add(task.id));
        // Let the check animation play before the row leaves the list.
        window.setTimeout(() => { void finishComplete(task); }, prefersReducedMotion() ? 0 : COMPLETE_ANIMATION_MS);
    }, [completing, finishComplete, sessionCompletions]);

    const undoComplete = useCallback(async () => {
        if (!undo) return;
        const current = undo;
        setUndo(null);
        try {
            await undoTaskCompletion(current.taskId, current.previousStatus, current.wasFocusedToday);
            await syncMainWindow();
        } catch (error) {
            reportError('Failed to undo task completion', error);
        }
    }, [undo]);

    const openTask = useCallback((task: Task) => {
        void openMainFromMenuBarPanel({ taskId: task.id })
            .catch((error) => reportError('Failed to open task in main window', error));
    }, []);

    const openMain = useCallback(() => {
        void openMainFromMenuBarPanel().catch((error) => reportError('Failed to open main window', error));
    }, []);

    const openCapture = useCallback(() => {
        void openMainFromMenuBarPanel({ openCapture: true })
            .catch((error) => reportError('Failed to open Quick Capture', error));
    }, []);

    const submitQuickAdd = useCallback(async (event: FormEvent) => {
        event.preventDefault();
        const text = quickAdd.trim();
        if (!text) return;
        setMessage(null);
        const state = useTaskStore.getState();
        const parsed = parseQuickAdd(text, state.projects, new Date(), state.areas, buildQuickAddParseOptions(state.settings, state));
        if (parsed.invalidDateCommands && parsed.invalidDateCommands.length > 0) {
            setMessage(`${tr('quickAdd.invalidDateCommand', 'Invalid date')}: ${parsed.invalidDateCommands.join(', ')}`);
            return;
        }
        const result = await executeCaptureTransaction(
            { parsed, rawInput: text, fallbackTitle: text, projects: state.projects },
            { addProject: state.addProject, addTask: state.addTask },
        );
        if (!result.success) {
            setMessage(tr('task.addFailed', 'Failed to add task'));
            return;
        }
        setQuickAdd('');
        showNotice(tr('menubar.added', 'Added'));
        await syncMainWindow();
    }, [quickAdd, showNotice, tr]);

    const submitAsk = useCallback((event: FormEvent) => {
        event.preventDefault();
        const text = ask.trim();
        if (!text) return;
        setAsk('');
        void openMainFromMenuBarPanel({ ask: text })
            .catch((error) => reportError('Failed to send question to the Assistant', error));
    }, [ask]);

    const moveRowFocus = useCallback((from: HTMLElement | null, delta: 1 | -1) => {
        const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-row-main]') ?? []);
        if (rows.length === 0) return false;
        const index = from ? rows.indexOf(from) : -1;
        if (index === -1 && delta === -1) return false;
        if (index + delta < 0) {
            captureRef.current?.focus();
            return true;
        }
        const target = rows[Math.min(rows.length - 1, index + delta)];
        target?.focus();
        target?.scrollIntoView({ block: 'nearest' });
        return true;
    }, []);

    const announce = useCallback((text: string) => {
        // Clear first so repeating the same message is announced again.
        setReorderAnnouncement('');
        window.setTimeout(() => setReorderAnnouncement(text), 30);
    }, []);

    const switchPanelToManual = useCallback((groupKey: string, ids: readonly string[]) => {
        const viewKey = manualOrderKeyForGroup(groupKey);
        if (!viewKey || readManualFlag(viewKey)) return;
        const snapshot = snapshotBoardOrder(statusesOf(ids));
        writeManualOrder(viewKey, true);
        setOrderUndo({ viewKey, snapshot });
        if (orderUndoTimer.current !== null) window.clearTimeout(orderUndoTimer.current);
        orderUndoTimer.current = window.setTimeout(() => setOrderUndo(null), UNDO_VISIBLE_MS);
    }, []);

    const undoManualSwitch = useCallback(async () => {
        if (!orderUndo) return;
        const current = orderUndo;
        setOrderUndo(null);
        writeManualOrder(current.viewKey, false);
        try {
            await restoreBoardOrder(current.snapshot);
            await syncMainWindow();
        } catch (error) {
            reportError('Failed to undo the switch to manual order', error);
        }
    }, [orderUndo]);

    const commitReorder = useCallback(async (change: PanelReorderChange, how: 'up' | 'down' | 'top' | 'drag') => {
        const kind = change.groupKey.split(':')[0];
        const store = useTaskStore.getState();
        try {
            if (kind === 'focus') {
                const result = await store.reorderFocusedTasks(change.nextIds);
                if (result && result.success === false) throw new Error(result.error || 'Failed to reorder tasks');
            } else {
                switchPanelToManual(change.groupKey, change.siblingIds);
                await commitBoardOrder(change.nextIds, change.movedId);
            }
            await syncMainWindow();
            const position = change.nextIds.indexOf(change.movedId) + 1;
            const key = how === 'up' ? 'menubar.reorder.movedUp'
                : how === 'down' ? 'menubar.reorder.movedDown'
                    : how === 'top' ? 'menubar.reorder.movedTop'
                        : 'menubar.reorder.moved';
            const fallback = how === 'up' ? 'Moved up, position {{position}} of {{count}}'
                : how === 'down' ? 'Moved down, position {{position}} of {{count}}'
                    : how === 'top' ? 'Moved to top, position {{position}} of {{count}}'
                        : 'Moved, position {{position}} of {{count}}';
            announce(formatI18nTemplate(tr(key, fallback), { position, count: change.nextIds.length }));
        } catch (error) {
            setMessage(tr('menubar.reorder.failed', 'Could not save the new order.'));
            reportError('Failed to reorder tasks from menu bar panel', error);
        }
    }, [announce, switchPanelToManual, tr]);

    const {
        state: dragState, ghost: dragGhost, ghostRef: dragGhostRef, beginPress: beginReorderPress, consumeSuppressedClick,
    } = usePanelReorder({
        listRef,
        onReorder: (change) => { void commitReorder(change, 'drag'); },
    });

    /** Movable rows of the group a row belongs to, in display order, read from the rendered list. */
    const readSiblings = useCallback((taskId: string): { groupKey: string; ids: string[] } | null => {
        const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-reorder-id]') ?? []);
        const row = rows.find((element) => element.getAttribute('data-reorder-id') === taskId);
        const groupKey = row?.getAttribute('data-reorder-group');
        if (!groupKey) return null;
        const ids = rows
            .filter((element) => element.getAttribute('data-reorder-group') === groupKey)
            .map((element) => element.getAttribute('data-reorder-id') as string);
        return { groupKey, ids };
    }, []);

    const focusRowMain = useCallback((taskId: string) => {
        window.requestAnimationFrame(() => {
            const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-row-main]') ?? []);
            const target = rows.find((element) => element.getAttribute('data-task-id') === taskId);
            target?.focus();
            target?.scrollIntoView?.({ block: 'nearest' });
        });
    }, []);

    const moveRow = useCallback((task: Task, action: PanelMoveAction) => {
        const group = readSiblings(task.id);
        if (!group) return;
        const nextIds = action === 'top'
            ? moveIdToTop(group.ids, task.id)
            : moveIdByOffset(group.ids, task.id, action === 'up' ? -1 : 1);
        if (idsAreEqual(nextIds, group.ids)) return;
        void commitReorder({ groupKey: group.groupKey, siblingIds: group.ids, nextIds, movedId: task.id }, action);
        focusRowMain(task.id);
    }, [commitReorder, focusRowMain, readSiblings]);

    const onRowKeyDown = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>, task: Task) => {
        if (event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey
            && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault();
            moveRow(task, event.key === 'ArrowUp' ? 'up' : 'down');
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            moveRowFocus(event.currentTarget, event.key === 'ArrowDown' ? 1 : -1);
        } else if (event.key === ' ') {
            event.preventDefault();
            completeTask(task);
        }
    }, [completeTask, moveRow, moveRowFocus]);

    const onCaptureKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'ArrowDown') {
            if (moveRowFocus(null, 1)) event.preventDefault();
        }
    };

    const openLabel = tr('tray.show', 'Open Stride');
    const completeLabel = tr('task.markDone', 'Mark done');
    const todayLabel = tr('menubar.today', 'Today');
    const pomodoroCandidates = useMemo(
        () => [...view.overdue, ...view.today, ...view.next].filter((task, index, all) => all.findIndex((other) => other.id === task.id) === index),
        [view],
    );

    const header = (
        <header className="flex items-start gap-2 px-4 pb-1 pt-3.5">
            <div className="min-w-0 flex-1">
                <h1 className="truncate text-[15px] font-semibold leading-tight tracking-tight">{dateLabel}</h1>
                {!locked && briefing?.headline && (
                    <p className="mt-1 flex items-center gap-1 text-xs leading-tight text-accent-text">
                        <Sparkles className="h-3 w-3 shrink-0" aria-hidden />
                        <span className="truncate" title={briefing.headline}>{briefing.headline}</span>
                    </p>
                )}
            </div>
            <div className="-mr-1.5 flex shrink-0 items-center gap-0.5">
                <IconButton label={tr('menubar.openApp', 'Open Stride')} onClick={openMain}>
                    <ExternalLink className="h-4 w-4" aria-hidden />
                </IconButton>
                {/* macOS has no tray menu (it swallowed left-clicks), so Lock and Quit live here. */}
                {lockEnabled && !locked && (
                    <IconButton
                        label={tr('appLock.lockNow', 'Lock now')}
                        onClick={() => void lockFromMenuBarPanel().catch((error) => reportError('Failed to lock', error))}
                    >
                        <Lock className="h-4 w-4" aria-hidden />
                    </IconButton>
                )}
                <IconButton
                    danger
                    label={tr('menubar.quit', 'Quit Stride')}
                    onClick={() => void quitFromMenuBarPanel().catch((error) => reportError('Failed to quit', error))}
                >
                    <Power className="h-4 w-4" aria-hidden />
                </IconButton>
            </div>
        </header>
    );

    if (locked) {
        return (
            <div className="flex h-full flex-col font-sans" data-testid="menubar-panel-locked">
                {header}
                <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                    <Lock className="h-6 w-6" aria-hidden />
                    <p>{tr('menubar.locked', 'Stride is locked')}</p>
                    <p className="text-xs">{openLabel}</p>
                </div>
            </div>
        );
    }

    const tabMeta: Record<PanelTab, { label: string; icon: ReactNode; count: number }> = {
        today: { label: tr('menubar.today', 'Today'), icon: <Sun className="h-3 w-3" aria-hidden />, count: view.counts.today },
        upcoming: { label: tr('menubar.upcoming', 'Upcoming'), icon: <CalendarDays className="h-3 w-3" aria-hidden />, count: view.counts.upcoming },
        inbox: { label: tr('nav.inbox', 'Inbox'), icon: <Inbox className="h-3 w-3" aria-hidden />, count: view.counts.inbox },
        next: { label: tr('nav.next', 'Next'), icon: <ListChecks className="h-3 w-3" aria-hidden />, count: view.counts.next },
    };

    const reorderLabels = {
        drag: tr('list.reorder.drag', 'Drag to reorder'),
        moveToTop: tr('list.reorder.moveToTop', 'Move to top'),
        moveUp: tr('projects.moveUp', 'Move up'),
        moveDown: tr('projects.moveDown', 'Move down'),
        moreActions: tr('menubar.reorder.moreActions', 'More actions'),
    };

    const renderRows = (list: Task[], tone: PanelRowTone, groups: PanelReorderGroup[] = []) => {
        const siblingsByGroup = new Map(groups.map((group) => [group.key, getMenuBarReorderIds(list, group.kind)]));
        return list.map((task) => {
            const group = groups.find((candidate) => isMenuBarTaskReorderable(task, candidate.kind));
            const siblingIds = group ? siblingsByGroup.get(group.key) ?? [] : [];
            const index = siblingIds.indexOf(task.id);
            const reorder: PanelRowReorder | null = group && index !== -1
                ? { groupKey: group.key, siblingIds, position: index + 1, count: siblingIds.length }
                : null;
            return (
                <PanelTaskRow
                    key={task.id}
                    task={task}
                    tone={tone}
                    project={task.projectId ? projectById.get(task.projectId) : undefined}
                    completing={completing.has(task.id) || task.status === 'done'}
                    completeLabel={task.status === 'done' ? tr('menubar.markNotDone', 'Mark not done') : completeLabel}
                    todayLabel={todayLabel}
                    priorityLabel={task.priority ? tr(`priority.${task.priority}`, task.priority) : undefined}
                    onComplete={completeTask}
                    onOpen={openTask}
                    onRowKeyDown={onRowKeyDown}
                    reorder={reorder}
                    reorderLabels={reorder ? reorderLabels : undefined}
                    dragging={dragState.dragId === task.id}
                    dropPlacement={reorder && dragState.targetId === task.id ? dragState.placement : null}
                    onReorderPointerDown={(event, row, info) => beginReorderPress(event, row.id, info.groupKey, info.siblingIds, row.title)}
                    consumeSuppressedClick={consumeSuppressedClick}
                    onMove={moveRow}
                />
            );
        });
    };

    const empty = (key: string, fallback: string, hint?: string) => (
        <div className="flex flex-col items-center gap-1 px-6 py-10 text-center" data-testid="menubar-panel-empty">
            <p className="text-sm font-medium text-foreground">{tr(key, fallback)}</p>
            {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
    );

    let body: ReactNode;
    if (tab === 'today') {
        const none = view.overdue.length + view.today.length === 0;
        body = (
            <>
                <PanelCalendarStrip
                    refreshKey={dayTick}
                    allDayLabel={tr('calendar.allDay', 'All day')}
                    moreLabel={(count) => `+${count} ${tr('menubar.moreEvents', 'more')}`}
                />
                {none
                    ? empty('menubar.empty', 'Nothing due today.', tr('menubar.emptyHint', 'Enjoy the calm, or capture something above.'))
                    : (
                        <>
                            {view.overdue.length > 0 && (
                                <section>
                                    <SectionHeader title={tr('menubar.overdue', 'Overdue')} count={view.overdue.length} />
                                    <ul>{renderRows(view.overdue, 'overdue', [{ key: 'focus:overdue', kind: 'focus' }, { key: 'today:overdue', kind: 'today' }])}</ul>
                                </section>
                            )}
                            {view.today.length > 0 && (
                                <section>
                                    <SectionHeader title={todayLabel} count={view.today.length} />
                                    <ul>{renderRows(view.today, 'today', [{ key: 'focus:today', kind: 'focus' }, { key: 'today:today', kind: 'today' }])}</ul>
                                </section>
                            )}
                        </>
                    )}
            </>
        );
    } else if (tab === 'upcoming') {
        body = view.upcoming.length === 0
            ? empty('menubar.emptyUpcoming', 'Nothing in the next 7 days.')
            : view.upcoming.map((day) => (
                <section key={day.key}>
                    <SectionHeader title={dayHeading(day.date)} count={day.tasks.length} />
                    <ul>{renderRows(day.tasks, 'default', [{ key: `upcoming:${day.key}`, kind: 'board' }])}</ul>
                </section>
            ));
    } else if (tab === 'inbox') {
        body = view.inbox.length === 0
            ? empty('menubar.emptyInbox', 'Inbox zero.', tr('menubar.emptyInboxHint', 'Everything is sorted.'))
            : <ul className="pt-1.5">{renderRows(view.inbox, 'default', [{ key: 'board:inbox', kind: 'board' }])}</ul>;
    } else {
        body = view.next.length === 0
            ? empty('menubar.emptyNext', 'No next actions yet.')
            : <ul className="pt-1.5">{renderRows(view.next, 'default', [{ key: 'board:next', kind: 'board' }])}</ul>;
    }

    return (
        <div className="flex h-full flex-col font-sans" data-testid="menubar-panel">
            {header}
            <span className="sr-only" aria-live="polite" data-testid="menubar-reorder-announcement">{reorderAnnouncement}</span>

            <div className="px-3 pb-2 pt-2">
                <div className="flex items-center gap-2">
                    <form onSubmit={(event) => void submitQuickAdd(event)} className="relative min-w-0 flex-1">
                        <Plus className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                        <input
                            ref={captureRef}
                            autoFocus
                            value={quickAdd}
                            onChange={(event) => setQuickAdd(event.target.value)}
                            onKeyDown={onCaptureKeyDown}
                            placeholder={tr('menubar.quickAdd', 'Add a task…')}
                            aria-label={tr('nav.addTask', 'Add task')}
                            title={tr('menubar.quickAddHint', 'Supports /due:tomorrow @context #tag +Project')}
                            className="h-9 w-full rounded-control bg-foreground/[0.06] shadow-soft-inset pl-8 pr-3 text-[13px] placeholder:text-tertiary transition-shadow focus-ring"
                        />
                    </form>
                    <button
                        type="button"
                        onClick={openCapture}
                        title={tr('menubar.aiCaptureHint', 'Brain dump with AI in Stride')}
                        className="btn-gradient inline-flex h-9 shrink-0 items-center gap-1.5 px-3 text-xs focus-ring"
                    >
                        <Sparkles className="h-3.5 w-3.5" aria-hidden />
                        {tr('menubar.aiCapture', 'AI Capture')}
                    </button>
                </div>
                <div className="h-4 pt-1 text-xs leading-none" aria-live="polite">
                    {notice && <span className="text-success-text">{notice}</span>}
                </div>
            </div>

            <div role="tablist" aria-label={tr('menubar.tabs', 'Lists')} className="mx-3 mb-1 flex gap-0.5 rounded-control bg-foreground/[0.07] shadow-soft-inset p-0.5">
                {TAB_ORDER.map((id) => {
                    const meta = tabMeta[id];
                    const active = tab === id;
                    return (
                        <button
                            key={id}
                            type="button"
                            role="tab"
                            aria-selected={active}
                            onClick={() => selectTab(id)}
                            className={cn(
                                'flex h-7 min-w-0 flex-1 items-center justify-center gap-1 rounded-lg px-1 text-xs font-medium transition-all duration-200 motion-reduce:transition-none',
                                'focus-ring',
                                active
                                    ? 'bg-card text-foreground shadow-soft-sm'
                                    : 'text-muted-foreground hover:text-foreground',
                            )}
                        >
                            <span className="truncate">{meta.label}</span>
                            <span
                                data-testid={`menubar-tab-count-${id}`}
                                className={cn(
                                    'rounded-full px-1.5 text-[11px] font-semibold tabular-nums leading-[16px]',
                                    active ? 'bg-accent-soft text-accent-text' : 'bg-foreground/[0.08] text-muted-foreground',
                                    meta.count === 0 && 'opacity-50',
                                )}
                            >
                                {meta.count}
                            </span>
                        </button>
                    );
                })}
            </div>

            <div ref={listRef} role="tabpanel" className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
                {body}
            </div>

            {orderUndo && (
                <div className="mx-3 mb-2 flex items-center gap-2 rounded-card bg-foreground px-3 py-2 text-xs text-background shadow-soft" role="status" data-testid="menubar-manual-order-undo">
                    <span className="min-w-0 flex-1 truncate">{switchedToManualOrderMessage(t)}</span>
                    <button type="button" onClick={() => void undoManualSwitch()} className="font-semibold underline-offset-2 hover:underline">
                        {tr('common.undo', 'Undo')}
                    </button>
                </div>
            )}
            {undo && (
                <div className="mx-3 mb-2 flex items-center gap-2 rounded-card bg-foreground px-3 py-2 text-xs text-background shadow-soft" role="status">
                    <span className="min-w-0 flex-1 truncate">{tr('menubar.completed', 'Completed')}: {undo.title}</span>
                    <button type="button" onClick={() => void undoComplete()} className="font-semibold underline-offset-2 hover:underline">
                        {tr('common.undo', 'Undo')}
                    </button>
                </div>
            )}
            {message && <p className="px-4 pb-1 text-xs text-danger-text" role="alert">{message}</p>}

            <div className="space-y-2 px-3 pb-3 pt-2.5">
                {pomodoroEnabled && <PanelPomodoro candidates={pomodoroCandidates} tr={tr} />}
                <form onSubmit={submitAsk} className="relative">
                    <input
                        value={ask}
                        onChange={(event) => setAsk(event.target.value)}
                        placeholder={tr('menubar.ask', 'Ask the Assistant…')}
                        aria-label={tr('menubar.askLabel', 'Ask the Assistant')}
                        className="h-9 w-full rounded-control bg-foreground/[0.06] shadow-soft-inset pl-3 pr-10 text-[13px] placeholder:text-tertiary focus-ring"
                    />
                    <button
                        type="submit"
                        aria-label={tr('menubar.askSend', 'Send to Assistant')}
                        disabled={!ask.trim()}
                        className="absolute right-1 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center btn-gradient rounded-lg transition-opacity disabled:bg-none disabled:shadow-none disabled:text-muted-foreground disabled:opacity-60"
                    >
                        <Send className="h-3.5 w-3.5" aria-hidden />
                    </button>
                </form>
            </div>
            {dragGhost && <PanelDragGhost ghost={dragGhost} ghostRef={dragGhostRef} />}
        </div>
    );
}
