import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import {
    filterMenuBarAllGroups,
    flushPendingSave,
    formatI18nTemplate,
    formatRecurrenceLabel,
    getMenuBarReorderIds,
    isMenuBarTaskReorderable,
    isTaskFocusedNow,
    isTaskFutureStart,
    moveIdByOffset,
    moveIdToTop,
    resolveFeatureFlags,
    retainCompletedInSections,
    selectMenuBarPanelView,
    translateWithFallback,
    undoTaskCompletion,
    useTaskStore,
    type MenuBarAllGroupKey,
    type MenuBarReorderKind,
    type PomodoroAutoStartOptions,
    type SectionMembership,
    type Task,
    type TaskStatus,
} from '@stride/core';
import { ExternalLink, Lock, Power, Sparkles } from 'lucide-react';
import { useLanguage } from '../contexts/language-context';
import { readCachedDailyBriefing } from '../lib/daily-briefing-service';
import {
    MENUBAR_NAVIGATE_EVENT,
    MENUBAR_PANEL_SHOWN_EVENT,
    hideMenuBarPanel,
    lockFromMenuBarPanel,
    notifyMainWindow,
    openMainFromMenuBarPanel,
    quitFromMenuBarPanel,
    type MenuBarNavigatePayload,
} from '../lib/menubar-panel-window';
import { QUICK_ADD_SAVED_EVENT } from '../lib/quick-add-saved-event';
import { reportError } from '../lib/report-error';
import { useCompletionRetention } from '../lib/completion-retention';
import { afterCompletionSequence, beginCompletion, cancelCompletion, isWithinDoubleClickGuard } from '../lib/completion-sequence';
import {
    describeRepeatingCompletion,
    guardRepeatTick,
    stopRepeatingOccurrence,
    type RepeatingCompletion,
} from '../lib/repeating-completion';
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
import { usePomodoroStore } from '../store/pomodoro-store';
import { CaptureComposer, type CaptureComposerHandle } from './capture/CaptureComposer';
import { SearchField } from './ui/SearchField';
import { PanelCalendarStrip } from './menubar/PanelCalendarStrip';
import { PanelInboxChip } from './menubar/PanelInboxChip';
import { PanelPomodoro, notifyPomodoroChanged } from './menubar/PanelPomodoro';
import { PanelDragGhost } from './menubar/PanelDragGhost';
import { PanelTaskRow, type PanelMoveAction, type PanelRowLabels, type PanelRowReorder, type PanelRowTone } from './menubar/PanelTaskRow';
import { idsAreEqual } from './menubar/panel-reorder';
import { usePanelReorder, type PanelReorderChange } from './menubar/usePanelReorder';
import { usePanelInboxSort } from './menubar/usePanelInboxSort';

const UNDO_VISIBLE_MS = 6000;
const NOTICE_VISIBLE_MS = 2200;
const TAB_STORAGE_KEY = 'stride-menubar-tab';

type PanelTab = 'now' | 'all';
const TAB_ORDER: PanelTab[] = ['now', 'all'];

type UndoState =
    | { kind: 'completed'; taskId: string; title: string; previousStatus: TaskStatus; wasFocusedToday: boolean; repeating: RepeatingCompletion | null }
    | { kind: 'stopped-repeating'; restore: () => Promise<void> };
type OrderUndoState = { viewKey: string; snapshot: BoardOrderSnapshot };
type PanelReorderGroup = { key: string; kind: MenuBarReorderKind };

/** The Now tab's three runs; each reorders on its own (focus through the Focus order, the rest through the Today order). */
const NOW_GROUPS: Record<'overdue' | 'focus' | 'today', PanelReorderGroup> = {
    overdue: { key: 'today:overdue', kind: 'today' },
    focus: { key: 'focus:now', kind: 'focus' },
    today: { key: 'today:today', kind: 'today' },
};

/**
 * The last tab, if it still exists. Older builds stored 'today' | 'upcoming' | 'inbox' | 'next':
 * every one of those (and anything unreadable) opens on Now.
 */
export function readStoredTab(): PanelTab {
    try {
        const value = window.localStorage.getItem(TAB_STORAGE_KEY);
        if (value === 'all') return 'all';
    } catch {
        // Storage can be unavailable; fall back to Now.
    }
    return 'now';
}

function storeTab(tab: PanelTab): void {
    try {
        window.localStorage.setItem(TAB_STORAGE_KEY, tab);
    } catch {
        // Ignore.
    }
}

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

function GroupHeader({ title, count }: { title: string; count: number }) {
    return (
        <h2 className="flex items-baseline gap-1.5 px-1 pb-1.5 pt-3 text-xs font-semibold text-muted-foreground first:pt-1">
            {title}
            <span className="font-medium tabular-nums text-tertiary">{count}</span>
        </h2>
    );
}

function HeaderButton({ label, onClick, children, danger }: { label: string; onClick: () => void; children: ReactNode; danger?: boolean }) {
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
    const projectSections = useTaskStore((state) => state.sections);
    const areas = useTaskStore((state) => state.areas);
    const pomodoroEnabled = useTaskStore((state) => resolveFeatureFlags(state.settings).pomodoro);
    const aiEnabled = useTaskStore((state) => state.settings?.ai?.enabled === true);
    const autoStartBreaks = useTaskStore((state) => state.settings.gtd?.pomodoro?.autoStartBreaks === true);
    const autoStartFocus = useTaskStore((state) => state.settings.gtd?.pomodoro?.autoStartFocus === true);
    const autoStart = useMemo<PomodoroAutoStartOptions>(() => ({ autoStartBreaks, autoStartFocus }), [autoStartBreaks, autoStartFocus]);
    const [locked, setLocked] = useState(false);
    const [lockEnabled, setLockEnabled] = useState(false);
    const [dayTick, setDayTick] = useState(0);
    const [undo, setUndo] = useState<UndoState | null>(null);
    const [orderUndo, setOrderUndo] = useState<OrderUndoState | null>(null);
    const orderUndoTimer = useRef<number | null>(null);
    const [manualToday] = useManualOrderMode(MANUAL_ORDER_KEYS.today);
    const [message, setMessage] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [tab, setTab] = useState<PanelTab>(readStoredTab);
    const [query, setQuery] = useState('');
    const [reorderAnnouncement, setReorderAnnouncement] = useState('');
    const undoTimer = useRef<number | null>(null);
    const noticeTimer = useRef<number | null>(null);
    const composerRef = useRef<CaptureComposerHandle>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const tabRefs = useRef<Record<PanelTab, HTMLButtonElement | null>>({ now: null, all: null });

    const focusCapture = useCallback((fromTrigger = false) => {
        // Opening the panel is opening capture: "Start voice recording when capture opens" applies.
        window.setTimeout(() => composerRef.current?.focus(fromTrigger ? { fromTrigger: true } : undefined), 30);
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
                    focusCapture(true);
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
    const areaById = useMemo(() => new Map(areas.map((area) => [area.id, area])), [areas]);
    const baseView = useMemo(() => {
        void dayTick;
        return selectMenuBarPanelView(tasks, { projects, sections: projectSections, now: new Date(), manualOrder: { today: manualToday } });
    }, [tasks, projects, projectSections, dayTick, manualToday]);
    // Completion rule: a task ticked done here stays in its list, struck through, and drops to the bottom of
    // that list after the settle delay (see core task-completion-order.ts). Counts stay open-task counts.
    const { retained: sessionCompletions, settledIds: settledCompletionIds, heldIds: heldOccurrenceIds } = useCompletionRetention();
    const tasksById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
    const sectionMembershipRef = useRef<SectionMembership>(new Map());
    const view = useMemo(() => {
        // Always run: it records each open task's list, which the very first tick needs to keep the row.
        const lists: Record<string, Task[]> = { now: baseView.now };
        baseView.all.forEach((group) => { lists[`all:${group.key}`] = group.tasks; });
        const merged = retainCompletedInSections(lists, sectionMembershipRef.current, sessionCompletions, settledCompletionIds, (id) => tasksById.get(id), { hiddenIds: heldOccurrenceIds });
        return {
            ...baseView,
            now: merged.now ?? baseView.now,
            all: baseView.all.map((group) => ({ ...group, tasks: merged[`all:${group.key}`] ?? group.tasks })),
        };
    }, [baseView, heldOccurrenceIds, sessionCompletions, settledCompletionIds, tasksById]);
    const allGroups = useMemo(
        () => filterMenuBarAllGroups(view.all, query, { projects, areas }),
        [areas, projects, query, view.all],
    );
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

    const selectTab = useCallback((next: PanelTab) => {
        setTab(next);
        storeTab(next);
    }, []);

    const showNotice = useCallback((text: string) => {
        setNotice(text);
        if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
        noticeTimer.current = window.setTimeout(() => setNotice(null), NOTICE_VISIBLE_MS);
    }, []);

    const showUndo = useCallback((next: UndoState) => {
        setUndo(next);
        if (undoTimer.current !== null) window.clearTimeout(undoTimer.current);
        undoTimer.current = window.setTimeout(() => setUndo(null), UNDO_VISIBLE_MS);
    }, []);

    const completeTask = useCallback((task: Task) => {
        if (task.status === 'done') {
            // A second click straight after the tick is a double click, not "untick".
            if (isWithinDoubleClickGuard(task.id)) return;
            // Ticked again: restore it to where it came from.
            const previousStatus = sessionCompletions.get(task.id)?.previousStatus ?? 'next';
            void undoTaskCompletion(task.id, previousStatus, false)
                .then(() => syncMainWindow())
                .catch((error) => reportError('Failed to restore task from menu bar panel', error));
            return;
        }
        guardRepeatTick(task.id, () => {
            // The completion sequence keeps the row on screen (pop, strike, hold, collapse) while the store
            // already has it done; a second click while it plays does nothing.
            if (!beginCompletion(task.id, { sound: true })) return;
            const previousStatus = task.status;
            const wasFocusedToday = task.isFocusedToday === true;
            void (async () => {
                try {
                    const result = await useTaskStore.getState().moveTask(task.id, 'done');
                    if (result && result.success === false) throw new Error(result.error || 'Failed to complete task');
                    const repeating = describeRepeatingCompletion(task.id, t);
                    const completed: UndoState = { kind: 'completed', taskId: task.id, title: task.title, previousStatus, wasFocusedToday, repeating };
                    if (repeating) afterCompletionSequence(task.id, () => showUndo(completed));
                    else showUndo(completed);
                    await syncMainWindow();
                } catch (error) {
                    cancelCompletion(task.id);
                    setMessage(error instanceof Error ? error.message : 'Failed to complete task');
                    reportError('Failed to complete task from menu bar panel', error);
                }
            })();
        });
    }, [sessionCompletions, showUndo, t]);

    const undoComplete = useCallback(async () => {
        if (!undo) return;
        const current = undo;
        setUndo(null);
        try {
            if (current.kind === 'stopped-repeating') await current.restore();
            else await undoTaskCompletion(current.taskId, current.previousStatus, current.wasFocusedToday);
            await syncMainWindow();
        } catch (error) {
            reportError('Failed to undo task completion', error);
        }
    }, [undo]);

    const stopRepeating = useCallback(async () => {
        if (undo?.kind !== 'completed' || !undo.repeating) return;
        const { occurrenceId } = undo.repeating;
        setUndo(null);
        try {
            showUndo({ kind: 'stopped-repeating', restore: await stopRepeatingOccurrence(occurrenceId) });
            await syncMainWindow();
        } catch (error) {
            reportError('Failed to stop repeating from menu bar panel', error);
        }
    }, [showUndo, undo]);

    const openTask = useCallback((task: Task) => {
        void openMainFromMenuBarPanel({ taskId: task.id })
            .catch((error) => reportError('Failed to open task in main window', error));
    }, []);

    const openMain = useCallback(() => {
        void openMainFromMenuBarPanel().catch((error) => reportError('Failed to open main window', error));
    }, []);

    /** "Review in Stride": the main window, on the Inbox. */
    const reviewInbox = useCallback(() => {
        if (!isTauriRuntime()) return;
        void openMainFromMenuBarPanel()
            .then(() => notifyMainWindow(MENUBAR_NAVIGATE_EVENT, { view: 'inbox' } satisfies MenuBarNavigatePayload))
            .catch((error) => reportError('Failed to open the Inbox from the menu bar panel', error));
    }, []);

    const onCaptured = useCallback(() => {
        void syncMainWindow();
    }, []);

    const inboxSort = usePanelInboxSort({
        language,
        label: (count) => formatI18nTemplate(tr('inboxHub.appliedLabel', 'Processed {{count}} Inbox items'), { count }),
        onChanged: syncMainWindow,
    });

    /** ＋: today's focus, after the tasks already there (a future start would hide it, so it starts now). */
    const addToNow = useCallback(async (task: Task): Promise<boolean> => {
        if (isTaskFocusedNow(task)) return true;
        const patch: Partial<Task> = { isFocusedToday: true };
        if (task.status === 'someday') patch.status = 'next';
        if (isTaskFutureStart(task, new Date())) patch.startTime = undefined;
        try {
            const result = await useTaskStore.getState().updateTask(task.id, patch);
            if (result && result.success === false) throw new Error(result.error || 'Failed to add to Now');
            await syncMainWindow();
            return true;
        } catch (error) {
            setMessage(tr('task.updateFailed', 'Could not update the task'));
            reportError('Failed to add a task to Now from the menu bar panel', error);
            return false;
        }
    }, [tr]);

    /** ▶: a focus session on this task; the main window shows the float per its setting. */
    const startTask = useCallback((task: Task) => {
        usePomodoroStore.getState().startPomodoroFocusForTask(task.id, autoStart);
        notifyPomodoroChanged();
    }, [autoStart]);

    const addToNowFromRow = useCallback((task: Task) => {
        void addToNow(task).then((ok) => { if (ok) showNotice(tr('menubar.addedToNow', 'Added to Now')); });
    }, [addToNow, showNotice, tr]);

    const startFromAll = useCallback((task: Task) => {
        void addToNow(task).then((ok) => { if (ok) startTask(task); });
    }, [addToNow, startTask]);

    const moveRowFocus = useCallback((from: HTMLElement | null, delta: 1 | -1) => {
        const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-row-main]') ?? []);
        if (rows.length === 0) return false;
        const index = from ? rows.indexOf(from) : -1;
        if (index === -1 && delta === -1) return false;
        if (index + delta < 0) {
            composerRef.current?.focus();
            return true;
        }
        const target = rows[Math.min(rows.length - 1, index + delta)];
        target?.focus();
        target?.scrollIntoView?.({ block: 'nearest' });
        return true;
    }, []);

    const announce = useCallback((text: string) => {
        // Clear first so repeating the same message is announced again.
        setReorderAnnouncement('');
        window.setTimeout(() => setReorderAnnouncement(text), 30);
    }, []);

    const switchPanelToManual = useCallback((groupKey: string, ids: readonly string[]) => {
        const viewKey = groupKey.startsWith('today:') ? MANUAL_ORDER_KEYS.today : null;
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

    /** Down from the note box (caret on its last line) goes to the first row. */
    const onCaptureKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'ArrowDown' || event.shiftKey || event.altKey || event.metaKey) return;
        const target = event.target as HTMLTextAreaElement;
        if (target.tagName !== 'TEXTAREA') return;
        if (target.value.slice(target.selectionEnd ?? 0).includes('\n')) return;
        if (moveRowFocus(null, 1)) event.preventDefault();
    };

    const onTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const next: PanelTab = tab === 'now' ? 'all' : 'now';
        selectTab(next);
        tabRefs.current[next]?.focus();
    };

    const openLabel = tr('tray.show', 'Open Stride');

    const header = (
        <header className="flex items-center gap-2 px-4 pb-1 pt-3">
            <div className="min-w-0 flex-1">
                <h1 className="truncate text-[13px] font-semibold leading-tight text-muted-foreground">{dateLabel}</h1>
                {!locked && briefing?.headline && (
                    <p className="mt-0.5 flex items-center gap-1 text-xs leading-tight text-accent-text">
                        <Sparkles className="h-3 w-3 shrink-0" aria-hidden />
                        <span className="truncate" title={briefing.headline}>{briefing.headline}</span>
                    </p>
                )}
            </div>
            <div className="-mr-1.5 flex shrink-0 items-center gap-0.5">
                <HeaderButton label={tr('menubar.openApp', 'Open Stride')} onClick={openMain}>
                    <ExternalLink className="h-4 w-4" aria-hidden />
                </HeaderButton>
                {/* macOS has no tray menu (it swallowed left-clicks), so Lock and Quit live here. */}
                {lockEnabled && !locked && (
                    <HeaderButton
                        label={tr('appLock.lockNow', 'Lock now')}
                        onClick={() => void lockFromMenuBarPanel().catch((error) => reportError('Failed to lock', error))}
                    >
                        <Lock className="h-4 w-4" aria-hidden />
                    </HeaderButton>
                )}
                <HeaderButton
                    danger
                    label={tr('menubar.quit', 'Quit Stride')}
                    onClick={() => void quitFromMenuBarPanel().catch((error) => reportError('Failed to quit', error))}
                >
                    <Power className="h-4 w-4" aria-hidden />
                </HeaderButton>
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

    const reorderLabels = {
        drag: tr('list.reorder.drag', 'Drag to reorder'),
        moveToTop: tr('list.reorder.moveToTop', 'Move to top'),
        moveUp: tr('projects.moveUp', 'Move up'),
        moveDown: tr('projects.moveDown', 'Move down'),
        moreActions: tr('menubar.reorder.moreActions', 'More actions'),
    };
    const rowLabels: PanelRowLabels = {
        waitsForT: t,
        complete: tr('task.markDone', 'Mark done'),
        markNotDone: tr('menubar.markNotDone', 'Mark not done'),
        today: tr('menubar.today', 'Today'),
        overdue: tr('menubar.overdue', 'Overdue'),
        focus: tr('menubar.focus', 'Focus'),
        start: tr('menubar.startTimer', 'Start a focus timer'),
        addToNow: tr('menubar.addToNow', 'Add to Now'),
    };
    const now = new Date();
    const toneOf = (task: Task): PanelRowTone => {
        if (view.nowParts.overdue.some((item) => item.id === task.id)) return 'overdue';
        const due = task.dueDate ?? task.startTime;
        if (due && new Date(due).getTime() < new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) return 'overdue';
        return 'today';
    };

    const renderRow = (task: Task, options: { tone: PanelRowTone; reorder: PanelRowReorder | null; mode: PanelTab }) => (
        <PanelTaskRow
            key={task.id}
            task={task}
            tone={options.tone}
            focused={options.mode === 'now' && isTaskFocusedNow(task, now)}
            project={task.projectId ? projectById.get(task.projectId) : undefined}
            area={!task.projectId && task.areaId ? areaById.get(task.areaId) : undefined}
            done={task.status === 'done'}
            labels={rowLabels}
            repeatLabel={formatRecurrenceLabel({ recurrence: task.recurrence, t })}
            dateFormat="EEE d MMM"
            priorityLabel={task.priority ? tr(`priority.${task.priority}`, task.priority) : undefined}
            onComplete={completeTask}
            onOpen={openTask}
            onRowKeyDown={onRowKeyDown}
            onStart={pomodoroEnabled ? (options.mode === 'now' ? startTask : startFromAll) : undefined}
            onAddToNow={options.mode === 'all' ? addToNowFromRow : undefined}
            reorder={options.reorder}
            reorderLabels={options.reorder ? reorderLabels : undefined}
            dragging={dragState.dragId === task.id}
            dropPlacement={options.reorder && dragState.targetId === task.id ? dragState.placement : null}
            onReorderPointerDown={(event, row, info) => beginReorderPress(event, row.id, info.groupKey, info.siblingIds, row.title)}
            consumeSuppressedClick={consumeSuppressedClick}
            onMove={options.reorder ? moveRow : undefined}
        />
    );

    const partOf = (task: Task): keyof typeof NOW_GROUPS => {
        if (view.nowParts.focus.some((item) => item.id === task.id)) return 'focus';
        if (view.nowParts.overdue.some((item) => item.id === task.id)) return 'overdue';
        // A row ticked done this session keeps its place; it no longer moves either way.
        return isTaskFocusedNow(task, now) ? 'focus' : 'today';
    };
    const renderNowRows = () => {
        const siblings = Object.fromEntries(Object.entries(NOW_GROUPS).map(([part, group]) => [
            part,
            getMenuBarReorderIds(view.now.filter((task) => partOf(task) === part), group.kind),
        ])) as Record<keyof typeof NOW_GROUPS, string[]>;
        return view.now.map((task) => {
            const part = partOf(task);
            const group = NOW_GROUPS[part];
            const ids = siblings[part];
            const index = ids.indexOf(task.id);
            const reorder: PanelRowReorder | null = isMenuBarTaskReorderable(task, group.kind) && index !== -1
                ? { groupKey: group.key, siblingIds: ids, position: index + 1, count: ids.length }
                : null;
            return renderRow(task, { tone: toneOf(task), reorder, mode: 'now' });
        });
    };
    const groupTitles: Record<MenuBarAllGroupKey, string> = {
        tomorrow: tr('menubar.tomorrow', 'Tomorrow'),
        week: tr('menubar.thisWeek', 'This week'),
        later: tr('menubar.later', 'Later'),
        none: tr('menubar.noDate', 'No date'),
    };

    const empty = (key: string, fallback: string, hint?: string) => (
        <div className="flex flex-col items-center gap-1 px-6 py-10 text-center" data-testid="menubar-panel-empty">
            <p className="text-sm font-medium text-foreground">{tr(key, fallback)}</p>
            {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
    );

    let body: ReactNode;
    if (tab === 'now') {
        body = (
            <>
                <PanelCalendarStrip
                    refreshKey={dayTick}
                    label={tr('menubar.calendarToday', 'Today’s calendar')}
                    allDayLabel={tr('calendar.allDay', 'All day')}
                    moreLabel={(count) => `+${count} ${tr('menubar.moreEvents', 'more')}`}
                />
                {view.now.length === 0
                    ? empty('menubar.emptyNow', 'Nothing for today yet.', tr('menubar.emptyNowHint', 'Add something from All tasks with ＋, or jot it down above.'))
                    : <ul className="flex flex-col gap-1.5">{renderNowRows()}</ul>}
            </>
        );
    } else {
        body = (
            <>
                <SearchField
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Escape' && query) {
                            event.preventDefault();
                            event.stopPropagation();
                            setQuery('');
                        } else if (event.key === 'ArrowDown') {
                            if (moveRowFocus(null, 1)) event.preventDefault();
                        }
                    }}
                    placeholder={tr('menubar.searchTasks', 'Search tasks')}
                    aria-label={tr('menubar.searchTasks', 'Search tasks')}
                    wrapperClassName="mb-1 h-8"
                    className="text-[13px]"
                    data-testid="menubar-search"
                />
                {view.all.length === 0
                    ? empty('menubar.emptyAll', 'Nothing else on your list.', tr('menubar.emptyAllHint', 'Everything open is in Now.'))
                    : allGroups.length === 0
                        ? empty('common.noMatches', 'No matches')
                        : allGroups.map((group) => (
                            <section key={group.key} data-testid={`menubar-group-${group.key}`}>
                                <GroupHeader title={groupTitles[group.key]} count={group.tasks.length} />
                                <ul className="flex flex-col gap-1.5">
                                    {group.tasks.map((task) => renderRow(task, { tone: 'default', reorder: null, mode: 'all' }))}
                                </ul>
                            </section>
                        ))}
            </>
        );
    }

    const tabMeta: Record<PanelTab, { label: string; count: number }> = {
        now: { label: tr('menubar.now', 'Now'), count: view.counts.now },
        all: { label: tr('menubar.allTasks', 'All tasks'), count: view.counts.all },
    };
    const pomodoroCandidates = [...view.now, ...view.all.flatMap((group) => group.tasks)]
        .filter((task) => task.status !== 'done')
        .slice(0, 60);

    return (
        <div className="flex h-full flex-col font-sans" data-testid="menubar-panel">
            {header}
            <span className="sr-only" aria-live="polite" data-testid="menubar-reorder-announcement">{reorderAnnouncement}</span>

            <div className="px-3 pb-2 pt-1.5" onKeyDown={onCaptureKeyDown}>
                <CaptureComposer
                    ref={composerRef}
                    variant="panel"
                    autoFocus
                    placeholder={tr('menubar.jot', 'Jot something down…')}
                    onSaved={onCaptured}
                />
                <PanelInboxChip
                    count={view.inboxCount}
                    canSort={aiEnabled}
                    phase={inboxSort.phase}
                    result={inboxSort.result}
                    notice={inboxSort.notice}
                    tr={tr}
                    onSort={() => { void inboxSort.sort(); }}
                    onUndo={() => { void inboxSort.undoSort(); }}
                    onReview={reviewInbox}
                    onDismissNotice={inboxSort.dismissNotice}
                />
            </div>

            <div role="tablist" aria-label={tr('menubar.tabs', 'Lists')} className="mx-3 mb-2 flex gap-0.5 rounded-control bg-well p-0.5 shadow-soft-inset">
                {TAB_ORDER.map((id) => {
                    const meta = tabMeta[id];
                    const active = tab === id;
                    return (
                        <button
                            key={id}
                            ref={(node) => { tabRefs.current[id] = node; }}
                            type="button"
                            role="tab"
                            id={`menubar-tab-${id}`}
                            aria-selected={active}
                            aria-controls="menubar-tabpanel"
                            tabIndex={active ? 0 : -1}
                            onClick={() => selectTab(id)}
                            onKeyDown={onTabKeyDown}
                            className={cn(
                                'motion-press flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[8px] px-2 text-[13px] font-medium transition-[color,background-color,box-shadow,scale] duration-200 ease-out motion-reduce:transition-none',
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
                                    'rounded-full px-1.5 text-[11px] font-semibold tabular-nums leading-[18px]',
                                    active ? 'bg-accent-soft text-accent-text' : 'bg-foreground/[0.08] text-muted-foreground',
                                    meta.count === 0 && 'opacity-60',
                                )}
                            >
                                {meta.count}
                            </span>
                        </button>
                    );
                })}
            </div>

            <div
                ref={listRef}
                role="tabpanel"
                id="menubar-tabpanel"
                aria-labelledby={`menubar-tab-${tab}`}
                className="min-h-0 flex-1 overflow-y-auto px-3 pb-3"
            >
                {body}
            </div>

            <div className="space-y-2 empty:hidden [&:not(:empty)]:px-3 [&:not(:empty)]:pb-2">
                {notice && (
                    <p className="pomo-in text-center text-xs font-medium text-success-text" role="status">{notice}</p>
                )}
                {orderUndo && (
                    <div className="flex items-center gap-2 rounded-card bg-foreground px-3 py-2 text-xs text-background shadow-soft" role="status" data-testid="menubar-manual-order-undo">
                        <span className="min-w-0 flex-1 truncate">{switchedToManualOrderMessage(t)}</span>
                        <button type="button" onClick={() => void undoManualSwitch()} className="font-semibold underline-offset-2 hover:underline">
                            {tr('common.undo', 'Undo')}
                        </button>
                    </div>
                )}
                {undo && (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-card bg-foreground px-3 py-2 text-xs text-background shadow-soft" role="status" data-testid="menubar-completion-undo">
                        {undo.kind === 'stopped-repeating'
                            ? <span className="min-w-0 flex-1">{tr('task.repeatStopped', 'Stopped repeating')}</span>
                            : undo.repeating
                                ? <span className="min-w-0 flex-1 basis-full">{undo.repeating.message}</span>
                                : <span className="min-w-0 flex-1 truncate">{tr('menubar.completed', 'Completed')}: {undo.title}</span>}
                        <button type="button" onClick={() => void undoComplete()} className="font-semibold underline-offset-2 hover:underline">
                            {tr('common.undo', 'Undo')}
                        </button>
                        {undo.kind === 'completed' && undo.repeating && (
                            <button type="button" onClick={() => void stopRepeating()} className="font-semibold underline-offset-2 hover:underline">
                                {tr('task.stopRepeating', 'Stop repeating')}
                            </button>
                        )}
                    </div>
                )}
                {message && <p className="text-xs text-danger-text" role="alert">{message}</p>}
            </div>

            {pomodoroEnabled && <PanelPomodoro candidates={pomodoroCandidates} tr={tr} />}
            {dragGhost && <PanelDragGhost ghost={dragGhost} ghostRef={dragGhostRef} />}
        </div>
    );
}
