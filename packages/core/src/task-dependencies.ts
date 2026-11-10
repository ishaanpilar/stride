import { formatI18nTemplate, translateWithFallback } from './i18n';
import type { Task, TaskStatus } from './types';

export const MAX_TASK_BLOCKERS = 50;
export const DEFAULT_BLOCKER_CANDIDATE_LIMIT = 20;

export type TaskLookup = Pick<ReadonlyMap<string, Task>, 'get'>;
export type DependencyRefusalReason = 'self' | 'missing' | 'cycle' | 'too-many';
export type DependencyCheck = { ok: true } | { ok: false; reason: DependencyRefusalReason; blockerId?: string };

const RESOLVED_BLOCKER_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>(['done', 'archived', 'reference']);

export const createTaskLookup = (tasks: Iterable<Task>): Map<string, Task> => {
    const lookup = new Map<string, Task>();
    for (const task of tasks) lookup.set(task.id, task);
    return lookup;
};

export function normalizeBlockedByTaskIds(value: unknown, selfId?: string): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const entry of value) {
        if (typeof entry !== 'string') continue;
        const id = entry.trim();
        if (!id || id === selfId || seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
        if (ids.length === MAX_TASK_BLOCKERS) break;
    }
    if (ids.length === 0) return undefined;
    return ids.length === value.length && ids.every((id, index) => id === value[index]) ? value as string[] : ids;
}

const blockerIdsOf = (task: Pick<Task, 'blockedByTaskIds'>): readonly string[] => (
    Array.isArray(task.blockedByTaskIds) ? task.blockedByTaskIds : []
);

export const hasTaskBlockers = (task: Pick<Task, 'blockedByTaskIds'>): boolean => blockerIdsOf(task).length > 0;

export const isBlockerOpen = (blocker: Task | undefined): blocker is Task => Boolean(
    blocker
    && !blocker.deletedAt
    && !blocker.purgedAt
    && !RESOLVED_BLOCKER_STATUSES.has(blocker.status),
);

const isLiveTask = (task: Task | undefined): task is Task => Boolean(task && !task.deletedAt && !task.purgedAt);

const waitsOn = (startId: string, targetId: string, lookup: TaskLookup): boolean => {
    const seen = new Set<string>([startId]);
    const pending = [startId];
    while (pending.length > 0) {
        const task = lookup.get(pending.pop() as string);
        if (!isLiveTask(task)) continue;
        for (const blockerId of blockerIdsOf(task)) {
            if (blockerId === targetId) return true;
            if (seen.has(blockerId)) continue;
            seen.add(blockerId);
            pending.push(blockerId);
        }
    }
    return false;
};

export function getBlockers(task: Pick<Task, 'blockedByTaskIds'>, lookup: TaskLookup): Task[] {
    return blockerIdsOf(task).map((id) => lookup.get(id)).filter(isLiveTask);
}

export function getOpenBlockers(task: Pick<Task, 'id' | 'blockedByTaskIds'>, lookup: TaskLookup): Task[] {
    return blockerIdsOf(task)
        .map((id) => lookup.get(id))
        .filter(isBlockerOpen)
        .filter((blocker) => blocker.id !== task.id && !waitsOn(blocker.id, task.id, lookup));
}

export function isTaskBlocked(task: Task, lookup: TaskLookup): boolean {
    return isBlockerOpen(task) && getOpenBlockers(task, lookup).length > 0;
}

export function getDependents(taskId: string, tasks: Iterable<Task>): Task[] {
    const dependents: Task[] = [];
    for (const task of tasks) {
        if (isLiveTask(task) && blockerIdsOf(task).includes(taskId)) dependents.push(task);
    }
    return dependents;
}

export function getBlockedTaskIds(tasks: readonly Task[], lookup?: TaskLookup): Set<string> {
    const blocked = new Set<string>();
    let resolvedLookup = lookup;
    for (const task of tasks) {
        if (!hasTaskBlockers(task)) continue;
        resolvedLookup ??= createTaskLookup(tasks);
        if (isTaskBlocked(task, resolvedLookup)) blocked.add(task.id);
    }
    return blocked;
}

export function canAddDependency(taskId: string, blockerId: string, lookup: TaskLookup): DependencyCheck {
    if (taskId === blockerId) return { ok: false, reason: 'self', blockerId };
    if (!isLiveTask(lookup.get(blockerId))) return { ok: false, reason: 'missing', blockerId };
    if (waitsOn(blockerId, taskId, lookup)) return { ok: false, reason: 'cycle', blockerId };
    return { ok: true };
}

export function validateBlockedByTaskIds(taskId: string, blockerIds: readonly string[], lookup: TaskLookup): DependencyCheck {
    if (blockerIds.length > MAX_TASK_BLOCKERS) return { ok: false, reason: 'too-many' };
    for (const blockerId of blockerIds) {
        const check = canAddDependency(taskId, blockerId, lookup);
        if (!check.ok) return check;
    }
    return { ok: true };
}

export function validateBlockerChange(
    task: Pick<Task, 'id' | 'blockedByTaskIds'>,
    nextBlockerIds: readonly string[],
    lookup: TaskLookup,
): DependencyCheck {
    const existing = new Set(blockerIdsOf(task));
    return validateBlockedByTaskIds(task.id, nextBlockerIds.filter((id) => !existing.has(id)), lookup);
}

export function getTasksUnblockedByResolving(
    resolvedIds: ReadonlySet<string>,
    tasks: Iterable<Task>,
    lookup: TaskLookup,
): Task[] {
    const unblocked: Task[] = [];
    for (const task of tasks) {
        if (resolvedIds.has(task.id) || !hasTaskBlockers(task) || !isBlockerOpen(task)) continue;
        const open = getOpenBlockers(task, lookup);
        if (open.length > 0 && open.every((blocker) => resolvedIds.has(blocker.id))) unblocked.push(task);
    }
    return unblocked;
}

export function getBlockersForNextOccurrence(task: Task, lookup: TaskLookup): string[] | undefined {
    return normalizeBlockedByTaskIds(blockerIdsOf(task).filter((id) => isBlockerOpen(lookup.get(id))), task.id);
}

export function withoutBlockers(task: Pick<Task, 'blockedByTaskIds'>, removedIds: ReadonlySet<string>): string[] | undefined {
    return normalizeBlockedByTaskIds(blockerIdsOf(task).filter((id) => !removedIds.has(id)));
}

export function getPurgedBlockerCleanup(
    purgedIds: ReadonlySet<string>,
    tasks: Iterable<Task>,
): Array<{ id: string; blockedByTaskIds: string[] | undefined }> {
    const cleanup: Array<{ id: string; blockedByTaskIds: string[] | undefined }> = [];
    for (const task of tasks) {
        if (task.purgedAt || purgedIds.has(task.id)) continue;
        if (!blockerIdsOf(task).some((id) => purgedIds.has(id))) continue;
        cleanup.push({ id: task.id, blockedByTaskIds: withoutBlockers(task, purgedIds) });
    }
    return cleanup;
}

export function remapBlockerIds(task: Task, idMap: ReadonlyMap<string, string>): string[] | undefined {
    return normalizeBlockedByTaskIds(blockerIdsOf(task).map((id) => idMap.get(id) ?? id), idMap.get(task.id) ?? task.id);
}

export type BlockerCandidateQuery = {
    task: Pick<Task, 'id' | 'projectId' | 'blockedByTaskIds'>;
    tasks: readonly Task[];
    lookup?: TaskLookup;
    query?: string;
    limit?: number;
};

export type BlockerCandidate = { task: Task; refusal?: DependencyRefusalReason };

export function getBlockerCandidates({
    task, tasks, lookup, query = '', limit = DEFAULT_BLOCKER_CANDIDATE_LIMIT,
}: BlockerCandidateQuery): BlockerCandidate[] {
    const resolvedLookup = lookup ?? createTaskLookup(tasks);
    const needle = query.trim().toLocaleLowerCase();
    const chosen = new Set(blockerIdsOf(task));
    const matches = tasks.filter((candidate) => (
        candidate.id !== task.id
        && !chosen.has(candidate.id)
        && isBlockerOpen(candidate)
        && (!needle || candidate.title.toLocaleLowerCase().includes(needle))
    ));
    const sameProject = (candidate: Task): number => (task.projectId && candidate.projectId === task.projectId ? 0 : 1);
    return matches
        .sort((a, b) => sameProject(a) - sameProject(b) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
        .slice(0, limit)
        .map((candidate) => {
            const check = canAddDependency(task.id, candidate.id, resolvedLookup);
            return check.ok ? { task: candidate } : { task: candidate, refusal: check.reason };
        });
}

type Translate = (key: string) => string;

const titlesSummary = (titles: readonly string[], t: Translate): string => {
    const [first, ...rest] = titles;
    if (rest.length === 0) return first ?? '';
    return formatI18nTemplate(translateWithFallback(t, 'dependencies.titleAndMore', '{{title}} +{{count}}'), {
        title: first ?? '',
        count: String(rest.length),
    });
};

export function formatWaitsForLabel(blockers: readonly Pick<Task, 'title'>[], t: Translate): string {
    return formatI18nTemplate(translateWithFallback(t, 'dependencies.waitsFor', 'Waits for: {{titles}}'), {
        titles: titlesSummary(blockers.map((blocker) => blocker.title), t),
    });
}

/** The question before a task that is still waiting is marked done. */
export function formatBlockedTickPrompt(blockers: readonly Pick<Task, 'title'>[], t: Translate): string {
    return formatI18nTemplate(translateWithFallback(t, 'dependencies.tickPrompt', 'This is waiting for {{titles}}.'), {
        titles: titlesSummary(blockers.map((blocker) => blocker.title), t),
    });
}

export function formatBulkBlockedTickPrompt(count: number, t: Translate): string {
    return formatI18nTemplate(
        translateWithFallback(t, 'dependencies.tickPromptSeveral', '{{count}} of these are waiting for other tasks.'),
        { count: String(count) },
    );
}

export function formatUnblockedToast(unblocked: readonly Pick<Task, 'title'>[], t: Translate): string {
    return formatI18nTemplate(translateWithFallback(t, 'dependencies.unblocked', 'Unblocked: {{titles}}'), {
        titles: titlesSummary(unblocked.map((task) => task.title), t),
    });
}

export function formatDependencyRefusal(check: Extract<DependencyCheck, { ok: false }>, t: Translate): string {
    switch (check.reason) {
        case 'self': return translateWithFallback(t, 'dependencies.refusedSelf', 'A task can’t wait for itself.');
        case 'cycle': return translateWithFallback(t, 'dependencies.refusedCycle',
            'That task already waits for this one, so they would block each other.');
        case 'too-many': return translateWithFallback(t, 'dependencies.refusedTooMany', 'This task has too many blockers.');
        default: return translateWithFallback(t, 'dependencies.refusedMissing', 'That task no longer exists.');
    }
}
