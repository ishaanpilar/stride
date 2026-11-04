import { endOfDay, startOfDay } from 'date-fns';

import { safeParseDate, safeParseDueDate } from './date';
import { isTaskInActiveProject } from './project-utils';
import { isTaskActionable } from './task-status';
import { isTaskFocusedNow, shouldShowTaskForStart, sortFocusNextActions } from './task-utils';
import type { Project, Task } from './types';

/**
 * Pure selection logic for the macOS menu bar panel (and the tray count badge).
 * Sections: overdue, today (due today, starting today, or added to today's focus) and a short
 * "next up" list. Every task appears in at most one section.
 */

export const MENUBAR_PANEL_NEXT_LIMIT = 5;

export interface MenuBarPanelSections {
    overdue: Task[];
    today: Task[];
    nextUp: Task[];
}

export interface MenuBarPanelOptions {
    projects?: Project[];
    now?: Date;
    nextLimit?: number;
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

    for (const task of tasks) {
        if (task.deletedAt || !isTaskActionable(task)) continue;
        if (task.status === 'someday') continue;
        if (!isTaskInActiveProject(task, projectMap)) continue;

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

/** Days after today covered by the Upcoming tab. */
export const MENUBAR_PANEL_UPCOMING_DAYS = 7;
export const MENUBAR_PANEL_LIST_LIMIT = 100;

export interface MenuBarPanelUpcomingDay {
    /** Local calendar day as yyyy-MM-dd. */
    key: string;
    /** Local midnight of that day. */
    date: Date;
    tasks: Task[];
}

export interface MenuBarPanelTabs {
    overdue: Task[];
    today: Task[];
    upcoming: MenuBarPanelUpcomingDay[];
    inbox: Task[];
    next: Task[];
    counts: { today: number; upcoming: number; inbox: number; next: number };
}

const dayKey = (date: Date): string => (
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
);

/**
 * Four-tab view model for the panel. Today = overdue + due/starting today + today's focus;
 * Upcoming = the next seven days grouped by day; Inbox = every inbox item; Next = all next
 * actions (a task may appear in both Today and Next).
 */
export function selectMenuBarPanelTabs(tasks: Task[], options: MenuBarPanelOptions = {}): MenuBarPanelTabs {
    const now = options.now ?? new Date();
    const projects = options.projects ?? [];
    const projectMap = new Map(projects.map((project) => [project.id, project]));
    const { overdue, today } = selectMenuBarPanelSections(tasks, { ...options, now, nextLimit: 0 });

    const todayStart = startOfDay(now);
    const rangeStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), todayStart.getDate() + 1).getTime();
    const rangeEnd = endOfDay(new Date(todayStart.getFullYear(), todayStart.getMonth(), todayStart.getDate() + MENUBAR_PANEL_UPCOMING_DAYS)).getTime();

    const byDay = new Map<string, MenuBarPanelUpcomingDay>();
    const inbox: Task[] = [];
    const nextCandidates: Task[] = [];

    for (const task of tasks) {
        if (task.deletedAt || !isTaskActionable(task)) continue;
        if (task.status === 'someday') continue;
        if (!isTaskInActiveProject(task, projectMap)) continue;

        if (task.status === 'inbox') inbox.push(task);
        if (task.status === 'next' && shouldShowTaskForStart(task, { now, granularity: 'time' })) nextCandidates.push(task);

        const when = safeParseDueDate(task.dueDate) ?? safeParseDate(task.startTime);
        const ms = when?.getTime();
        if (when && ms !== undefined && ms >= rangeStart && ms <= rangeEnd) {
            const date = startOfDay(when);
            const key = dayKey(date);
            const bucket = byDay.get(key) ?? { key, date, tasks: [] };
            bucket.tasks.push(task);
            byDay.set(key, bucket);
        }
    }

    const upcoming = [...byDay.values()]
        .sort((a, b) => a.date.getTime() - b.date.getTime())
        .map((day) => ({ ...day, tasks: sortUrgentFirst(day.tasks) }));
    const sortedInbox = [...inbox].sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
    const next = sortFocusNextActions(nextCandidates, { now, prioritizeByPriority: true, projects })
        .slice(0, MENUBAR_PANEL_LIST_LIMIT);

    const sortedOverdue = sortUrgentFirst(overdue);
    const sortedToday = sortUrgentFirst(today);
    return {
        overdue: sortedOverdue,
        today: sortedToday,
        upcoming,
        inbox: sortedInbox,
        next,
        counts: {
            today: sortedOverdue.length + sortedToday.length,
            upcoming: upcoming.reduce((sum, day) => sum + day.tasks.length, 0),
            inbox: sortedInbox.length,
            next: next.length,
        },
    };
}
