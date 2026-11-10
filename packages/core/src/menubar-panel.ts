import { endOfDay, startOfDay } from 'date-fns';

import { safeParseDate, safeParseDueDate } from './date';
import { isTaskInActiveProject } from './project-utils';
import { sortTasksByManualOrder } from './task-completion-order';
import { getBlockedTaskIds } from './task-dependencies';
import { isTaskActionable } from './task-status';
import {
    getFocusSequentialFirstTaskIds,
    getTaskSequencing,
    hasTaskSequences,
    isTaskFocusedNow,
    isTaskSequenceBlocked,
    shouldShowTaskForStart,
    sortFocusNextActions,
} from './task-utils';
import type { Project, Section, Task } from './types';

/**
 * Pure selection logic for the macOS menu bar panel (and the tray count badge).
 * Sections: overdue, today (due today, starting today, or added to today's focus) and a short
 * "next up" list. Every task appears in at most one section. The panel's two tabs (Now, All tasks)
 * come from `selectMenuBarPanelView`.
 */

export const MENUBAR_PANEL_NEXT_LIMIT = 5;

export interface MenuBarPanelSections {
    overdue: Task[];
    today: Task[];
    nextUp: Task[];
}

export interface MenuBarPanelOptions {
    projects?: Project[];
    /** Project sections, so per-section "Next action only" projects block the same tasks Focus does. */
    sections?: Section[];
    now?: Date;
    nextLimit?: number;
    manualOrder?: MenuBarManualOrder;
}

const PRIORITY_URGENCY: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

const dueOrStartMs = (task: Task): number => (
    safeParseDueDate(task.dueDate)?.getTime()
    ?? safeParseDate(task.startTime)?.getTime()
    ?? Number.POSITIVE_INFINITY
);

/** Urgent first, then earliest due/start time, then oldest created. */
function sortUrgentFirst(tasks: Task[]): Task[] {
    return [...tasks].sort((a, b) => {
        const byPriority = (PRIORITY_URGENCY[a.priority ?? ''] ?? 4) - (PRIORITY_URGENCY[b.priority ?? ''] ?? 4);
        if (byPriority !== 0) return byPriority;
        const aTime = dueOrStartMs(a);
        const bTime = dueOrStartMs(b);
        if (aTime !== bTime) return aTime < bTime ? -1 : 1;
        return String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''));
    });
}

export function applyMenuBarFocusOrder(tasks: Task[], now: Date = new Date(), manualToday = false): Task[] {
    const focused: Task[] = [];
    const rest: Task[] = [];
    for (const task of tasks) {
        if (isTaskFocusedNow(task, now)) focused.push(task);
        else rest.push(task);
    }
    const orderedRest = manualToday ? sortTasksByManualOrder(rest, 'boardOrder') : rest;
    if (!manualToday && !focused.some((task) => Number.isFinite(task.focusOrder))
        && focused.every((task, index) => tasks[index] === task)) return tasks;
    return [...sortTasksByManualOrder(focused, 'focusOrder'), ...orderedRest];
}

export type MenuBarReorderKind = 'focus' | 'today' | 'board';

export interface MenuBarManualOrder {
    /** The Today view (and the panel's Now tab) is in manual order: non-focused rows follow boardOrder. */
    today?: boolean;
}

export function isMenuBarTaskReorderable(task: Task, kind: MenuBarReorderKind, now: Date = new Date()): boolean {
    if (task.deletedAt || task.status === 'done' || task.status === 'archived' || task.status === 'reference') return false;
    if (kind === 'board') return true;
    return kind === 'focus' ? isTaskFocusedNow(task, now) : !isTaskFocusedNow(task, now);
}

/** Ids of the rows of `list` that take part in manual reordering, in display order. */
export function getMenuBarReorderIds(list: readonly Task[], kind: MenuBarReorderKind, now: Date = new Date()): string[] {
    return list.filter((task) => isMenuBarTaskReorderable(task, kind, now)).map((task) => task.id);
}

/**
 * Tasks a "Next action only" project is holding back, decided the way Focus decides them. A task with a
 * focus star always stays: the star is an explicit choice. Status other than next is never "blocked".
 */
function createMenuBarSequenceBlockedCheck(
    tasks: readonly Task[],
    projects: readonly Project[],
    sections: readonly Section[] | undefined,
    now: Date,
): (task: Task) => boolean {
    const sequencing = getTaskSequencing(projects, sections);
    if (!hasTaskSequences(sequencing)) return () => false;
    const candidates = tasks.filter((task) => !task.deletedAt);
    const firstTaskIds = getFocusSequentialFirstTaskIds(candidates, sequencing.sequentialProjectIds, {
        now,
        sectionScopedProjectIds: sequencing.sectionScopedProjectIds,
        sequentialSectionKeys: sequencing.sequentialSectionKeys,
        sections,
    });
    return (task) => task.status === 'next' && !isTaskFocusedNow(task, now)
        && isTaskSequenceBlocked(task, sequencing, firstTaskIds);
}

export function selectMenuBarPanelSections(tasks: Task[], options: MenuBarPanelOptions = {}): MenuBarPanelSections {
    const now = options.now ?? new Date();
    const projects = options.projects ?? [];
    const nextLimit = options.nextLimit ?? MENUBAR_PANEL_NEXT_LIMIT;
    const dayStart = startOfDay(now).getTime();
    const dayEnd = endOfDay(now).getTime();
    const projectMap = new Map(projects.map((project) => [project.id, project]));

    const overdue: Task[] = [];
    const today: Task[] = [];
    const nextCandidates: Task[] = [];
    const isSequenceBlocked = createMenuBarSequenceBlockedCheck(tasks, projects, options.sections, now);
    const dependencyBlockedIds = getBlockedTaskIds(tasks);

    for (const task of tasks) {
        if (task.deletedAt || !isTaskActionable(task)) continue;
        if (task.status === 'someday') continue;
        if (!isTaskInActiveProject(task, projectMap)) continue;
        if (isSequenceBlocked(task)) continue;
        if (dependencyBlockedIds.has(task.id) && !isTaskFocusedNow(task, now)) continue;

        const due = safeParseDueDate(task.dueDate)?.getTime();
        const start = safeParseDate(task.startTime)?.getTime();
        const startsToday = start !== undefined && start >= dayStart && start <= dayEnd;

        if (due !== undefined && due < dayStart) {
            overdue.push(task);
        } else if ((due !== undefined && due <= dayEnd) || startsToday || isTaskFocusedNow(task, now)) {
            today.push(task);
        } else if (task.status === 'next' && shouldShowTaskForStart(task, { now, granularity: 'time' })) {
            nextCandidates.push(task);
        }
    }

    const nextUp = sortFocusNextActions(nextCandidates, { now, prioritizeByPriority: true, projects })
        .slice(0, Math.max(0, nextLimit));

    return { overdue: sortUrgentFirst(overdue), today: sortUrgentFirst(today), nextUp };
}

/** Number of overdue + today tasks, used for the tray badge. */
export function countMenuBarPanelTasks(tasks: Task[], options: MenuBarPanelOptions = {}): number {
    const { overdue, today } = selectMenuBarPanelSections(tasks, { ...options, nextLimit: 0 });
    return overdue.length + today.length;
}

/** Days after today (tomorrow included) that count as "This week" in the All tasks tab. */
export const MENUBAR_PANEL_WEEK_DAYS = 7;

export type MenuBarAllGroupKey = 'tomorrow' | 'week' | 'later' | 'none';
export const MENUBAR_ALL_GROUP_ORDER: readonly MenuBarAllGroupKey[] = ['tomorrow', 'week', 'later', 'none'];

export interface MenuBarAllGroup {
    key: MenuBarAllGroupKey;
    tasks: Task[];
}

export interface MenuBarPanelView {
    /** Everything for today in one list: overdue, then today's focus, then due/starting today. */
    now: Task[];
    /** The three contiguous runs of `now` (each reorders on its own). */
    nowParts: { overdue: Task[]; focus: Task[]; today: Task[] };
    /** Every other open actionable task, tomorrow to someday, grouped by date (empty groups dropped). */
    all: MenuBarAllGroup[];
    counts: { now: number; all: number };
    /** Live Inbox items (shown as a chip, not as a tab). */
    inboxCount: number;
}

/**
 * Two-tab view model for the menu bar panel.
 * - Now: overdue + today's focus + due or starting today. Focused rows keep their Focus order; the
 *   others follow the urgency/due-time order, or the board order when Today is in manual order.
 * - All tasks: open next/someday tasks that are not in Now, grouped Tomorrow / This week / Later /
 *   No date, priority first within a group. Inbox items and Waiting are not here (Inbox has its chip).
 */
export function selectMenuBarPanelView(tasks: Task[], options: MenuBarPanelOptions = {}): MenuBarPanelView {
    const now = options.now ?? new Date();
    const projects = options.projects ?? [];
    const projectMap = new Map(projects.map((project) => [project.id, project]));
    const { overdue, today } = selectMenuBarPanelSections(tasks, { ...options, now, nextLimit: 0 });
    const manualToday = options.manualOrder?.today === true;
    const byBoard = (list: Task[]) => (manualToday ? sortTasksByManualOrder(list, 'boardOrder') : list);

    const focus = sortTasksByManualOrder(
        sortUrgentFirst([...overdue, ...today].filter((task) => isTaskFocusedNow(task, now))),
        'focusOrder',
    );
    const otherOverdue = byBoard(sortUrgentFirst(overdue.filter((task) => !isTaskFocusedNow(task, now))));
    const otherToday = byBoard(sortUrgentFirst(today.filter((task) => !isTaskFocusedNow(task, now))));
    const nowIds = new Set([...overdue, ...today].map((task) => task.id));

    const todayStart = startOfDay(now);
    const tomorrowStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), todayStart.getDate() + 1).getTime();
    const tomorrowEnd = endOfDay(new Date(tomorrowStart)).getTime();
    const weekEnd = endOfDay(new Date(todayStart.getFullYear(), todayStart.getMonth(), todayStart.getDate() + MENUBAR_PANEL_WEEK_DAYS)).getTime();

    const isSequenceBlocked = createMenuBarSequenceBlockedCheck(tasks, projects, options.sections, now);
    const buckets: Record<MenuBarAllGroupKey, Task[]> = { tomorrow: [], week: [], later: [], none: [] };
    let inboxCount = 0;
    const dependencyBlockedIds = getBlockedTaskIds(tasks);
    for (const task of tasks) {
        if (task.deletedAt || !isTaskActionable(task)) continue;
        if (!isTaskInActiveProject(task, projectMap)) continue;
        if (task.status === 'inbox') { inboxCount += 1; continue; }
        if (task.status !== 'next' && task.status !== 'someday') continue;
        if (nowIds.has(task.id) || isSequenceBlocked(task) || dependencyBlockedIds.has(task.id)) continue;
        const when = safeParseDueDate(task.dueDate) ?? safeParseDate(task.startTime);
        const ms = when?.getTime();
        if (ms === undefined || !Number.isFinite(ms)) buckets.none.push(task);
        else if (ms <= tomorrowEnd) buckets.tomorrow.push(task);
        else if (ms <= weekEnd) buckets.week.push(task);
        else buckets.later.push(task);
    }

    const all = MENUBAR_ALL_GROUP_ORDER
        .map((key) => ({ key, tasks: sortUrgentFirst(buckets[key]) }))
        .filter((group) => group.tasks.length > 0);
    const nowList = [...otherOverdue, ...focus, ...otherToday];
    return {
        now: nowList,
        nowParts: { overdue: otherOverdue, focus, today: otherToday },
        all,
        counts: { now: nowList.length, all: all.reduce((sum, group) => sum + group.tasks.length, 0) },
        inboxCount,
    };
}

/** Case-insensitive title / project / area / context / tag match for the All tasks search field. */
export function filterMenuBarAllGroups(
    groups: readonly MenuBarAllGroup[],
    query: string,
    lookup: { projects?: readonly Pick<Project, 'id' | 'title'>[]; areas?: readonly { id: string; name: string }[] } = {},
): MenuBarAllGroup[] {
    const needle = query.trim().toLowerCase();
    if (!needle) return [...groups];
    const projectTitle = new Map((lookup.projects ?? []).map((project) => [project.id, project.title]));
    const areaName = new Map((lookup.areas ?? []).map((area) => [area.id, area.name]));
    const matches = (task: Task) => [
        task.title,
        task.projectId ? projectTitle.get(task.projectId) : undefined,
        task.areaId ? areaName.get(task.areaId) : undefined,
        ...(task.contexts ?? []),
        ...(task.tags ?? []),
    ].some((value) => typeof value === 'string' && value.toLowerCase().includes(needle));
    return groups
        .map((group) => ({ ...group, tasks: group.tasks.filter(matches) }))
        .filter((group) => group.tasks.length > 0);
}
