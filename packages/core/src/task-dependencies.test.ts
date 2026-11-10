import { describe, expect, it } from 'vitest';
import {
    canAddDependency,
    createTaskLookup,
    formatDependencyRefusal,
    formatUnblockedToast,
    formatWaitsForLabel,
    getBlockedTaskIds,
    getBlockerCandidates,
    getBlockers,
    getBlockersForNextOccurrence,
    getDependents,
    getOpenBlockers,
    getPurgedBlockerCleanup,
    getTasksUnblockedByResolving,
    isBlockerOpen,
    isTaskBlocked,
    normalizeBlockedByTaskIds,
    remapBlockerIds,
    validateBlockedByTaskIds,
    withoutBlockers,
} from './task-dependencies';
import { createNextRecurringTask } from './recurrence';
import { stampNewRecurringFollowUp } from './store-helpers';
import type { Task } from './types';

const NOW = '2026-11-08T10:00:00.000Z';
const task = (id: string, extra: Partial<Task> = {}): Task => ({
    id, title: id.toUpperCase(), status: 'next', tags: [], contexts: [], createdAt: NOW, updatedAt: NOW, ...extra,
}) as Task;
const lookupOf = (...tasks: Task[]) => createTaskLookup(tasks);
const identity = (key: string) => key;

describe('normalizeBlockedByTaskIds', () => {
    it('trims, dedupes, drops self and non-strings', () => {
        expect(normalizeBlockedByTaskIds([' a ', 'a', 'b', 7, 'self', ''], 'self')).toEqual(['a', 'b']);
    });
    it('turns empty and malformed values into absence', () => {
        expect(normalizeBlockedByTaskIds([])).toBeUndefined();
        expect(normalizeBlockedByTaskIds(null)).toBeUndefined();
        expect(normalizeBlockedByTaskIds('nope')).toBeUndefined();
    });
    it('returns the same array when nothing changed', () => {
        const ids = ['a', 'b'];
        expect(normalizeBlockedByTaskIds(ids)).toBe(ids);
    });
    it('caps the list', () => {
        const ids = Array.from({ length: 60 }, (_, index) => `id-${index}`);
        expect(normalizeBlockedByTaskIds(ids)).toHaveLength(50);
    });
});

describe('isTaskBlocked and blockers', () => {
    it('blocks while a blocker is open and unblocks when done', () => {
        const a = task('a');
        const b = task('b', { blockedByTaskIds: ['a'] });
        expect(isTaskBlocked(b, lookupOf(a, b))).toBe(true);
        expect(isTaskBlocked(b, lookupOf({ ...a, status: 'done' }, b))).toBe(false);
    });

    it.each(['done', 'archived', 'reference'] as const)('treats a %s blocker as resolved', (status) => {
        const a = task('a', { status });
        expect(isBlockerOpen(a)).toBe(false);
        expect(isTaskBlocked(task('b', { blockedByTaskIds: ['a'] }), lookupOf(a))).toBe(false);
    });

    it.each(['inbox', 'waiting', 'someday'] as const)('keeps a %s blocker blocking', (status) => {
        const a = task('a', { status });
        expect(isTaskBlocked(task('b', { blockedByTaskIds: ['a'] }), lookupOf(a))).toBe(true);
    });

    it('ignores missing, deleted and purged blockers', () => {
        const deleted = task('d', { deletedAt: NOW });
        const purged = task('p', { purgedAt: NOW, deletedAt: NOW });
        const b = task('b', { blockedByTaskIds: ['missing', 'd', 'p'] });
        expect(isTaskBlocked(b, lookupOf(deleted, purged, b))).toBe(false);
        expect(getBlockers(b, lookupOf(deleted, purged, b))).toEqual([]);
    });

    it('needs every blocker resolved', () => {
        const a = task('a', { status: 'done' });
        const c = task('c');
        const b = task('b', { blockedByTaskIds: ['a', 'c'] });
        expect(getOpenBlockers(b, lookupOf(a, c, b)).map((t) => t.id)).toEqual(['c']);
        expect(isTaskBlocked(b, lookupOf(a, c, b))).toBe(true);
    });

    it('never treats a finished or deleted task as blocked', () => {
        const a = task('a');
        expect(isTaskBlocked(task('b', { blockedByTaskIds: ['a'], status: 'done' }), lookupOf(a))).toBe(false);
        expect(isTaskBlocked(task('b', { blockedByTaskIds: ['a'], deletedAt: NOW }), lookupOf(a))).toBe(false);
    });

    it('stays blocked behind a blocked chain', () => {
        const a = task('a');
        const b = task('b', { blockedByTaskIds: ['a'] });
        const c = task('c', { blockedByTaskIds: ['b'] });
        expect(isTaskBlocked(c, lookupOf(a, b, c))).toBe(true);
    });

    it('does not deadlock on a cycle that slipped in through sync', () => {
        const a = task('a', { blockedByTaskIds: ['b'] });
        const b = task('b', { blockedByTaskIds: ['a'] });
        expect(isTaskBlocked(a, lookupOf(a, b))).toBe(false);
        expect(isTaskBlocked(b, lookupOf(a, b))).toBe(false);
        expect(getBlockedTaskIds([a, b])).toEqual(new Set());
    });

    it('finds dependents and lists blocked ids across a whole task list', () => {
        const a = task('a');
        const b = task('b', { blockedByTaskIds: ['a'] });
        const gone = task('c', { blockedByTaskIds: ['a'], deletedAt: NOW });
        expect(getDependents('a', [a, b, gone]).map((t) => t.id)).toEqual(['b']);
        expect(getBlockedTaskIds([a, b, gone])).toEqual(new Set(['b']));
    });
});

describe('canAddDependency', () => {
    const a = task('a');
    const b = task('b', { blockedByTaskIds: ['a'] });
    const c = task('c', { blockedByTaskIds: ['b'], projectId: 'other' });

    it('rejects self and missing tasks', () => {
        expect(canAddDependency('a', 'a', lookupOf(a))).toEqual({ ok: false, reason: 'self', blockerId: 'a' });
        expect(canAddDependency('a', 'nope', lookupOf(a))).toEqual({ ok: false, reason: 'missing', blockerId: 'nope' });
        expect(canAddDependency('a', 'x', lookupOf(a, task('x', { deletedAt: NOW })))).toMatchObject({ ok: false, reason: 'missing' });
    });

    it('rejects direct and transitive cycles across projects', () => {
        expect(canAddDependency('a', 'b', lookupOf(a, b, c))).toMatchObject({ ok: false, reason: 'cycle' });
        expect(canAddDependency('a', 'c', lookupOf(a, b, c))).toMatchObject({ ok: false, reason: 'cycle' });
    });

    it('allows a fresh edge and a new task with no id yet', () => {
        const d = task('d');
        expect(canAddDependency('d', 'c', lookupOf(a, b, c, d))).toEqual({ ok: true });
        expect(canAddDependency('new', 'a', lookupOf(a))).toEqual({ ok: true });
    });

    it('validates a whole list and reports the first problem', () => {
        expect(validateBlockedByTaskIds('a', ['b'], lookupOf(a, b))).toMatchObject({ ok: false, reason: 'cycle', blockerId: 'b' });
        expect(validateBlockedByTaskIds('d', ['a', 'b'], lookupOf(a, b))).toEqual({ ok: true });
    });
});

describe('getTasksUnblockedByResolving', () => {
    it('finds tasks whose last open blocker just finished, once', () => {
        const a = task('a');
        const b = task('b', { blockedByTaskIds: ['a'] });
        const c = task('c', { blockedByTaskIds: ['a', 'x'] });
        const x = task('x');
        const lookup = lookupOf(a, b, c, x);
        expect(getTasksUnblockedByResolving(new Set(['a']), [a, b, c, x], lookup).map((t) => t.id)).toEqual(['b']);
    });
    it('summarises several unblocked tasks in one message', () => {
        expect(formatUnblockedToast([{ title: 'B' }, { title: 'C' }], identity)).toBe('Unblocked: B +1');
        expect(formatWaitsForLabel([{ title: 'A' }, { title: 'B' }, { title: 'C' }], identity)).toBe('Waits for: A +2');
    });
    it('explains cycle refusals', () => {
        expect(formatDependencyRefusal({ ok: false, reason: 'cycle' }, identity)).toMatch(/block each other/);
    });
});

describe('repeating tasks', () => {
    const repeating = (id: string, extra: Partial<Task> = {}) => task(id, { recurrence: { rule: 'daily' }, ...extra });

    it('a repeating blocker resolves when the occurrence completes and the next occurrence does not re-block', () => {
        const blocker = repeating('r');
        const dependent = task('d', { blockedByTaskIds: ['r'] });
        const completed = { ...blocker, status: 'done' as const, completedAt: NOW };
        const nextOccurrence = createNextRecurringTask(blocker, NOW, 'next');
        expect(nextOccurrence).not.toBeNull();
        const after = lookupOf(completed, dependent, nextOccurrence!);
        expect(isTaskBlocked(dependent, after)).toBe(false);
    });

    it('a repeating dependent keeps only blockers that are still open', () => {
        const open = task('open');
        const finished = task('finished', { status: 'done' });
        const source = repeating('d', { blockedByTaskIds: ['open', 'finished'] });
        const next = createNextRecurringTask(source, NOW, 'next')!;
        expect(getBlockersForNextOccurrence(next, lookupOf(open, finished))).toEqual(['open']);
        const stamped = stampNewRecurringFollowUp(next, 'device', undefined, () => undefined, [open, finished]);
        expect(stamped?.blockedByTaskIds).toEqual(['open']);
    });

    it('drops inherited blockers entirely when none are open', () => {
        const source = repeating('d', { blockedByTaskIds: ['finished'] });
        const next = createNextRecurringTask(source, NOW, 'next')!;
        const stamped = stampNewRecurringFollowUp(next, 'device', undefined, () => undefined, [task('finished', { status: 'done' })]);
        expect(stamped).not.toHaveProperty('blockedByTaskIds');
    });

    it('does not put blockers on occurrences of a plain repeating task', () => {
        const next = createNextRecurringTask(repeating('d'), NOW, 'next')!;
        expect(next).not.toHaveProperty('blockedByTaskIds');
    });
});

describe('cleanup and copies', () => {
    it('removes purged blockers from dependents without touching others', () => {
        const dependent = task('b', { blockedByTaskIds: ['a', 'keep'] });
        const unrelated = task('c', { blockedByTaskIds: ['keep'] });
        expect(getPurgedBlockerCleanup(new Set(['a']), [dependent, unrelated])).toEqual([
            { id: 'b', blockedByTaskIds: ['keep'] },
        ]);
    });
    it('clears the field when the last blocker is purged', () => {
        expect(getPurgedBlockerCleanup(new Set(['a']), [task('b', { blockedByTaskIds: ['a'] })])).toEqual([
            { id: 'b', blockedByTaskIds: undefined },
        ]);
        expect(withoutBlockers(task('b', { blockedByTaskIds: ['a'] }), new Set(['a']))).toBeUndefined();
    });
    it('remaps ids and keeps external blockers when a project is copied', () => {
        const copy = task('new-b', { blockedByTaskIds: ['a', 'outside'] });
        expect(remapBlockerIds(copy, new Map([['a', 'new-a'], ['b', 'new-b']]))).toEqual(['new-a', 'outside']);
    });
});

describe('getBlockerCandidates', () => {
    const current = task('task', { projectId: 'p1', blockedByTaskIds: ['chosen'] });
    const tasks = [
        current,
        task('chosen', { projectId: 'p1' }),
        task('other-project', { projectId: 'p2', title: 'Alpha elsewhere' }),
        task('same-project', { projectId: 'p1', title: 'Beta here' }),
        task('done', { status: 'done', title: 'Done task' }),
        task('deleted', { deletedAt: NOW, title: 'Deleted' }),
        task('waits-on-me', { blockedByTaskIds: ['task'], title: 'Waits on me' }),
    ];

    it('lists open tasks with the same project first and flags cycles', () => {
        const candidates = getBlockerCandidates({ task: current, tasks });
        expect(candidates.map((c) => c.task.id)).toEqual(['same-project', 'other-project', 'waits-on-me']);
        expect(candidates.find((c) => c.task.id === 'waits-on-me')?.refusal).toBe('cycle');
        expect(candidates[0].refusal).toBeUndefined();
    });

    it('filters by title', () => {
        expect(getBlockerCandidates({ task: current, tasks, query: 'beta' }).map((c) => c.task.id)).toEqual(['same-project']);
    });
});
