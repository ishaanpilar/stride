import { safeParseDate, safeParseDueDate } from './date';
import { getTodayBounds } from './focus-sections';
import {
    buildSequentialSectionOrder,
    compareAreasByOrder,
    compareProjectsByOrder,
    compareTasksBySectionOrder,
    isTaskFocusedNow,
    PRIORITY_RANK,
} from './task-utils';
import type { Area, Project, Section, Task, TaskPriority } from './types';

/**
 * The Projects layout of Focus: one card per project with open next actions, showing only that project's
 * next action, and the tasks that belong to no project after the cards. Pure: it derives from the lists
 * focus-sections already built (so sequencing and the Today's Focus / Today exclusions are decided there).
 */

export type FocusProjectCard = {
    project: Project;
    /** The one task the card shows while it is collapsed. */
    nextAction: Task;
    /** The project's other open next actions, in order, shown when the card is expanded. */
    moreActions: Task[];
    /** Next actions a "Next action only" project is holding back, in order. Dimmed when expanded. */
    lockedTasks: Task[];
    doneCount: number;
    totalCount: number;
    /** 0 overdue, 1 urgent or due today, 2 focused, 3 nothing pressing. */
    urgencyRank: number;
};

export type FocusLooseGroup = {
    areaId: string | null;
    tasks: Task[];
};

export type FocusProjectLayout = {
    cards: FocusProjectCard[];
    looseTasks: Task[];
    /** The loose tasks by area, in area order (tasks with no area last). Empty when they should stay flat. */
    looseGroups: FocusLooseGroup[];
    counts: { projects: number; looseTasks: number };
};

export type BuildFocusProjectLayoutInput = {
    /** The Next Actions section as Focus derived it, including rows ticked this session. */
    nextActions: readonly Task[];
    /** Every task, for the "3 of 11" progress. Deleted ones are ignored. */
    allTasks: readonly Task[];
    /** Next actions held back by sequencing (FocusTaskLists.sequentialBlockedIds resolved to tasks). */
    lockedTasks?: readonly Task[];
    projects: readonly Project[];
    sections?: readonly Section[];
    areas?: readonly Area[];
    /** Ticked rows whose completion sequence has finished: they leave the card so the next task can rise. */
    settledDoneIds?: ReadonlySet<string>;
    now: Date;
    prioritiesEnabled?: boolean;
    /** Cards follow the manual project order only, without urgent projects rising above it. */
    manualProjectOrder?: boolean;
};

const taskOrder = (task: Pick<Task, 'order' | 'orderNum'>): number => {
    if (Number.isFinite(task.order)) return task.order as number;
    if (Number.isFinite(task.orderNum)) return task.orderNum as number;
    return Number.POSITIVE_INFINITY;
};

const dueTime = (task: Pick<Task, 'dueDate'>): number => (
    safeParseDueDate(task.dueDate)?.getTime() ?? Number.POSITIVE_INFINITY
);

const createdTime = (task: Pick<Task, 'createdAt'>): number => (
    safeParseDate(task.createdAt)?.getTime() ?? Number.POSITIVE_INFINITY
);

const priorityRank = (task: Pick<Task, 'priority'>): number => (
    PRIORITY_RANK[task.priority as TaskPriority] || 0
);

const compareNumbers = (a: number, b: number): number => (a === b ? 0 : a < b ? -1 : 1);

export function compareFocusProjectTasks(
    a: Task,
    b: Task,
    sectionOrder: ReturnType<typeof buildSequentialSectionOrder>,
    prioritiesEnabled = true,
): number {
    const section = compareTasksBySectionOrder(a, b, sectionOrder);
    if (section !== 0) return section;
    const order = compareNumbers(taskOrder(a), taskOrder(b));
    if (order !== 0) return order;
    if (prioritiesEnabled) {
        const priority = priorityRank(b) - priorityRank(a);
        if (priority !== 0) return priority;
    }
    const due = compareNumbers(dueTime(a), dueTime(b));
    if (due !== 0) return due;
    const created = compareNumbers(createdTime(a), createdTime(b));
    if (created !== 0) return created;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

const isOpenProjectTask = (task: Task): boolean => (
    !task.deletedAt && task.status !== 'done' && task.status !== 'archived' && task.status !== 'reference'
);

function getProjectUrgencyRank(
    project: Project,
    openTasks: readonly Task[],
    now: Date,
    prioritiesEnabled: boolean,
): number {
    const { startOfToday, endOfToday } = getTodayBounds(now);
    const projectDue = safeParseDueDate(project.dueDate)?.getTime();
    let rank = project.isFocused === true ? 2 : 3;
    if (projectDue !== undefined && projectDue < startOfToday.getTime()) return 0;
    if (projectDue !== undefined && projectDue <= endOfToday.getTime()) rank = Math.min(rank, 1);
    for (const task of openTasks) {
        const due = safeParseDueDate(task.dueDate)?.getTime();
        if (due !== undefined && due < startOfToday.getTime()) return 0;
        if (due !== undefined && due <= endOfToday.getTime()) rank = Math.min(rank, 1);
        if (prioritiesEnabled && task.priority === 'urgent') rank = Math.min(rank, 1);
        if (isTaskFocusedNow(task, now)) rank = Math.min(rank, 2);
    }
    return rank;
}

function compareCards(
    a: FocusProjectCard,
    b: FocusProjectCard,
    areaRank: ReadonlyMap<string, number>,
    manualProjectOrder: boolean,
): number {
    if (!manualProjectOrder && a.urgencyRank !== b.urgencyRank) return a.urgencyRank - b.urgencyRank;
    // A project's manual order is only meaningful within its area (see reorderProjects).
    const aArea = a.project.areaId ? areaRank.get(a.project.areaId) ?? Number.POSITIVE_INFINITY : Number.POSITIVE_INFINITY;
    const bArea = b.project.areaId ? areaRank.get(b.project.areaId) ?? Number.POSITIVE_INFINITY : Number.POSITIVE_INFINITY;
    const area = compareNumbers(aArea, bArea);
    if (area !== 0) return area;
    return compareProjectsByOrder(a.project, b.project);
}

export function buildFocusProjectLayout(input: BuildFocusProjectLayoutInput): FocusProjectLayout {
    const { nextActions, allTasks, projects, sections, areas = [], lockedTasks = [], settledDoneIds, now } = input;
    const prioritiesEnabled = input.prioritiesEnabled !== false;
    const projectById = new Map(projects.filter((project) => !project.deletedAt && project.status === 'active')
        .map((project) => [project.id, project]));
    const sectionOrder = buildSequentialSectionOrder(sections);

    const rowsByProject = new Map<string, Task[]>();
    const looseTasks: Task[] = [];
    for (const task of nextActions) {
        const project = task.projectId ? projectById.get(task.projectId) : undefined;
        if (!project) {
            looseTasks.push(task);
            continue;
        }
        // A ticked row keeps its place until its sequence ends, then leaves the card.
        if (task.status === 'done' && settledDoneIds?.has(task.id)) continue;
        const rows = rowsByProject.get(project.id) ?? [];
        rows.push(task);
        rowsByProject.set(project.id, rows);
    }

    const lockedByProject = new Map<string, Task[]>();
    for (const task of lockedTasks) {
        if (!task.projectId || !rowsByProject.has(task.projectId)) continue;
        const rows = lockedByProject.get(task.projectId) ?? [];
        rows.push(task);
        lockedByProject.set(task.projectId, rows);
    }

    const projectTaskStats = new Map<string, { done: number; open: Task[] }>();
    for (const task of allTasks) {
        if (!task.projectId || task.deletedAt || !rowsByProject.has(task.projectId)) continue;
        const stats = projectTaskStats.get(task.projectId) ?? { done: 0, open: [] };
        if (task.status === 'done') stats.done += 1;
        else if (isOpenProjectTask(task)) stats.open.push(task);
        projectTaskStats.set(task.projectId, stats);
    }

    const compareTasks = (a: Task, b: Task) => compareFocusProjectTasks(a, b, sectionOrder, prioritiesEnabled);
    const cards: FocusProjectCard[] = [];
    rowsByProject.forEach((rows, projectId) => {
        const project = projectById.get(projectId) as Project;
        const [nextAction, ...moreActions] = [...rows].sort(compareTasks);
        const stats = projectTaskStats.get(projectId) ?? { done: 0, open: [] };
        cards.push({
            project,
            nextAction,
            moreActions,
            lockedTasks: [...(lockedByProject.get(projectId) ?? [])].sort(compareTasks),
            doneCount: stats.done,
            totalCount: stats.done + stats.open.length,
            urgencyRank: getProjectUrgencyRank(project, stats.open, now, prioritiesEnabled),
        });
    });

    const areaRank = new Map([...areas].filter((area) => !area.deletedAt).sort(compareAreasByOrder)
        .map((area, index) => [area.id, index] as const));
    cards.sort((a, b) => compareCards(a, b, areaRank, input.manualProjectOrder === true));

    return {
        cards,
        looseTasks,
        looseGroups: groupLooseTasksByArea(looseTasks, areaRank),
        counts: {
            projects: cards.length,
            looseTasks: looseTasks.filter((task) => task.status !== 'done').length,
        },
    };
}

function groupLooseTasksByArea(tasks: readonly Task[], areaRank: ReadonlyMap<string, number>): FocusLooseGroup[] {
    const groups = new Map<string | null, Task[]>();
    for (const task of tasks) {
        const areaId = task.areaId && areaRank.has(task.areaId) ? task.areaId : null;
        const rows = groups.get(areaId) ?? [];
        rows.push(task);
        groups.set(areaId, rows);
    }
    if (groups.size <= 1) return [];
    return [...groups.entries()]
        .map(([areaId, rows]) => ({ areaId, tasks: rows }))
        .sort((a, b) => compareNumbers(
            a.areaId === null ? Number.POSITIVE_INFINITY : areaRank.get(a.areaId) as number,
            b.areaId === null ? Number.POSITIVE_INFINITY : areaRank.get(b.areaId) as number,
        ));
}
