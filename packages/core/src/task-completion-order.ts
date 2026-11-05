import type { Task, TaskStatus } from './types';

/**
 * Completion rule (desktop and menu bar lists):
 *
 * A task that is ticked done while a view is open does not vanish. For the rest of the app session it
 * stays in the view it was ticked in, struck through, and (after a short settle delay so the tick reads)
 * it moves to the bottom of its list or section. Unticking puts it back in its place. Tasks completed in
 * earlier sessions follow the existing rules: hidden unless the view is the Done view or shows completed.
 *
 * This module holds the pure parts: tracking which tasks were completed this session, deciding which
 * status a retained task still "belongs" to for view filtering, and the stable done-last partition.
 */

/** How long a freshly ticked row stays in place before dropping to the bottom. */
export const COMPLETION_SETTLE_DELAY_MS = 400;

export type RetainedCompletion = {
    /** Status the task had right before it was ticked (the view it belonged to). */
    previousStatus: TaskStatus;
    /** Wall-clock ms when the completion was observed in this session. */
    observedAt: number;
};

export type RetainedCompletions = ReadonlyMap<string, RetainedCompletion>;

type StatusTask = Pick<Task, 'id' | 'status'>;

/**
 * Compares two task snapshots and returns the updated retained map. Returns the same map instance when
 * nothing changed so callers can cheaply skip notifications.
 */
export function collectCompletionTransitions(
    previous: readonly StatusTask[],
    next: readonly StatusTask[],
    retained: RetainedCompletions,
    now: number = Date.now(),
): RetainedCompletions {
    if (previous === next) return retained;
    const previousById = new Map<string, TaskStatus>();
    for (const task of previous) previousById.set(task.id, task.status);
    let result: Map<string, RetainedCompletion> | null = null;
    const mutable = () => (result ??= new Map(retained));
    const nextIds = new Set<string>();
    for (const task of next) {
        nextIds.add(task.id);
        const before = previousById.get(task.id);
        if (task.status === 'done') {
            if (before && before !== 'done' && before !== 'archived' && !retained.has(task.id)) {
                mutable().set(task.id, { previousStatus: before, observedAt: now });
            }
        } else if (retained.has(task.id)) {
            // Unticked (or moved elsewhere): the task is a normal open task again.
            mutable().delete(task.id);
        }
    }
    for (const id of retained.keys()) {
        if (!nextIds.has(id)) mutable().delete(id);
    }
    return result ?? retained;
}

/**
 * Status a task should be treated as having for view-membership filtering. A task completed this session
 * keeps counting as its previous status so status-based views (Inbox, Next, ...) keep showing it.
 */
export function effectiveViewStatus(task: StatusTask, retained: RetainedCompletions | undefined): TaskStatus {
    if (task.status !== 'done' || !retained) return task.status;
    return retained.get(task.id)?.previousStatus ?? task.status;
}

export function isRetainedCompletion(task: StatusTask, retained: RetainedCompletions | undefined): boolean {
    return task.status === 'done' && Boolean(retained?.has(task.id));
}

/** Ids of retained completions whose settle delay has elapsed (they may now drop to the bottom). */
export function getSettledCompletionIds(
    retained: RetainedCompletions,
    now: number,
    delayMs: number = COMPLETION_SETTLE_DELAY_MS,
): Set<string> {
    const settled = new Set<string>();
    for (const [id, entry] of retained) {
        if (now - entry.observedAt >= delayMs) settled.add(id);
    }
    return settled;
}

/** Milliseconds until the next retained completion settles, or null when none are pending. */
export function nextSettleDelay(
    retained: RetainedCompletions,
    now: number,
    delayMs: number = COMPLETION_SETTLE_DELAY_MS,
): number | null {
    let next: number | null = null;
    for (const entry of retained.values()) {
        const remaining = entry.observedAt + delayMs - now;
        if (remaining > 0 && (next === null || remaining < next)) next = remaining;
    }
    return next;
}

export type PartitionDoneLastOptions<T> = {
    /** Done tasks for which this returns true stay where they are (the tick is still settling). */
    holdInPlace?: (task: T) => boolean;
};

/**
 * Stable partition: open tasks first in their current order, then done tasks in their current order.
 * Returns the input array when nothing needs to move.
 */
export function partitionDoneLast<T extends Pick<Task, 'status'> & { id?: string }>(
    tasks: readonly T[],
    options: PartitionDoneLastOptions<T> = {},
): T[] {
    const open: T[] = [];
    const done: T[] = [];
    for (const task of tasks) {
        if (task.status === 'done' && !options.holdInPlace?.(task)) done.push(task);
        else open.push(task);
    }
    if (done.length === 0) return tasks as T[];
    return [...open, ...done];
}

type ManualOrderField = 'boardOrder' | 'focusOrder' | 'order';

const finite = (value: number | undefined): number | undefined => (
    typeof value === 'number' && Number.isFinite(value) ? value : undefined
);

/**
 * Manual order: tasks with a stored order come first (ascending); tasks without one keep their incoming
 * relative order after them. Done tasks are not reordered here (use partitionDoneLast afterwards).
 */
export function sortTasksByManualOrder<T extends Partial<Record<ManualOrderField, number>>>(
    tasks: readonly T[],
    field: ManualOrderField,
): T[] {
    const keyed = tasks.map((task, index) => ({ task, index, order: finite(task[field]) }));
    keyed.sort((a, b) => {
        if (a.order !== undefined && b.order !== undefined) return a.order !== b.order ? a.order - b.order : a.index - b.index;
        if (a.order !== undefined) return -1;
        if (b.order !== undefined) return 1;
        return a.index - b.index;
    });
    return keyed.map((entry) => entry.task);
}

/** Moves `movedId` to `targetIndex` (index in the list after removing it). Returns a new array. */
export function moveIdToIndex(ids: readonly string[], movedId: string, targetIndex: number): string[] {
    const from = ids.indexOf(movedId);
    if (from === -1) return [...ids];
    const rest = ids.filter((id) => id !== movedId);
    const clamped = Math.max(0, Math.min(rest.length, targetIndex));
    rest.splice(clamped, 0, movedId);
    return rest;
}

export type DropPlacement = 'before' | 'after';

/** Resulting id order when dropping `movedId` before/after `targetId`. Unchanged copy if either is missing. */
export function reorderIdsForDrop(
    ids: readonly string[],
    movedId: string,
    targetId: string,
    placement: DropPlacement,
): string[] {
    if (movedId === targetId || !ids.includes(movedId) || !ids.includes(targetId)) return [...ids];
    const rest = ids.filter((id) => id !== movedId);
    const targetIndex = rest.indexOf(targetId);
    rest.splice(placement === 'before' ? targetIndex : targetIndex + 1, 0, movedId);
    return rest;
}

export function moveIdToTop(ids: readonly string[], movedId: string): string[] {
    return moveIdToIndex(ids, movedId, 0);
}

/** Moves one step up (-1) or down (+1). Unchanged copy at the edges. */
export function moveIdByOffset(ids: readonly string[], movedId: string, offset: -1 | 1): string[] {
    const from = ids.indexOf(movedId);
    if (from === -1) return [...ids];
    const to = from + offset;
    if (to < 0 || to >= ids.length) return [...ids];
    const next = [...ids];
    [next[from], next[to]] = [next[to], next[from]];
    return next;
}

export function idsEqual(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((id, index) => id === b[index]);
}

export type SectionMembership = Map<string, { key: string; index: number }>;

/**
 * For multi-section views (Today/Focus) whose membership is not a plain status: remembers which section
 * (and position) each open task was in, and when a task ticked this session drops out of the derived
 * lists, puts it back where it was (still settling) or at the bottom of that section (settled), struck
 * through by the row. `memory` is mutated; keep one per view instance.
 */
export function retainCompletedInSections<K extends string, T extends Pick<Task, 'id' | 'status'>>(
    lists: Record<K, T[]>,
    memory: SectionMembership,
    retained: RetainedCompletions,
    settledIds: ReadonlySet<string>,
    getTask: (id: string) => T | undefined,
): Record<K, T[]> {
    const keys = Object.keys(lists) as K[];
    const present = new Set<string>();
    for (const key of keys) {
        lists[key].forEach((task, index) => {
            present.add(task.id);
            if (task.status !== 'done') memory.set(task.id, { key, index });
        });
    }
    const additions = new Map<K, Array<{ index: number; task: T }>>();
    for (const [id, entry] of memory) {
        if (present.has(id)) continue;
        if (!retained.has(id)) {
            memory.delete(id);
            continue;
        }
        const task = getTask(id);
        if (!task || task.status !== 'done' || !(entry.key in lists)) continue;
        const bucket = additions.get(entry.key as K) ?? [];
        bucket.push({ index: entry.index, task });
        additions.set(entry.key as K, bucket);
    }
    const result = { ...lists } as Record<K, T[]>;
    for (const key of keys) {
        const bucket = additions.get(key);
        let next = lists[key];
        if (bucket?.length) {
            next = [...next];
            bucket.sort((a, b) => a.index - b.index);
            for (const { index, task } of bucket) {
                if (settledIds.has(task.id)) next.push(task);
                else next.splice(Math.min(index, next.length), 0, task);
            }
        }
        result[key] = partitionDoneLast(next, { holdInPlace: (task) => retained.has(task.id) && !settledIds.has(task.id) });
    }
    return result;
}

export function splitOrderedIdsByStatus<S extends string>(
    ids: readonly string[],
    statusOf: (id: string) => S | undefined,
): Array<{ status: S; ids: string[] }> {
    const groups = new Map<S, string[]>();
    for (const id of ids) {
        const status = statusOf(id);
        if (status === undefined) continue;
        const list = groups.get(status);
        if (list) list.push(id);
        else groups.set(status, [id]);
    }
    return [...groups.entries()].map(([status, groupIds]) => ({ status, ids: groupIds }));
}
