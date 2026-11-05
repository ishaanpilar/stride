import { describe, expect, it } from 'vitest';
import {
    splitOrderedIdsByStatus,
    collectCompletionTransitions,
    effectiveViewStatus,
    getSettledCompletionIds,
    moveIdByOffset,
    moveIdToTop,
    nextSettleDelay,
    partitionDoneLast,
    reorderIdsForDrop,
    retainCompletedInSections,
    type SectionMembership,
    sortTasksByManualOrder,
    type RetainedCompletions,
} from './task-completion-order';
import type { TaskStatus } from './types';

const t = (id: string, status: TaskStatus = 'next') => ({ id, status });

describe('partitionDoneLast', () => {
    it('keeps open tasks first and done last, each in current order', () => {
        const result = partitionDoneLast([t('a', 'done'), t('b'), t('c', 'done'), t('d')]);
        expect(result.map((x) => x.id)).toEqual(['b', 'd', 'a', 'c']);
    });
    it('returns the same array when nothing is done', () => {
        const input = [t('a'), t('b')];
        expect(partitionDoneLast(input)).toBe(input);
    });
    it('holds still-settling done tasks in place', () => {
        const result = partitionDoneLast([t('a', 'done'), t('b'), t('c', 'done')], { holdInPlace: (x) => x.id === 'a' });
        expect(result.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    });
});

describe('collectCompletionTransitions', () => {
    const empty: RetainedCompletions = new Map();
    it('retains a task ticked done with its previous status', () => {
        const next = collectCompletionTransitions([t('a', 'inbox')], [t('a', 'done')], empty, 1000);
        expect(next.get('a')).toEqual({ previousStatus: 'inbox', observedAt: 1000 });
    });
    it('ignores tasks that were already done or newly appear done', () => {
        expect(collectCompletionTransitions([t('a', 'done')], [t('a', 'done')], empty)).toBe(empty);
        expect(collectCompletionTransitions([], [t('a', 'done')], empty)).toBe(empty);
    });
    it('drops the entry when unticked', () => {
        const retained = collectCompletionTransitions([t('a')], [t('a', 'done')], empty, 5);
        const after = collectCompletionTransitions([t('a', 'done')], [t('a')], retained);
        expect(after.has('a')).toBe(false);
    });
    it('drops the entry when the task disappears', () => {
        const retained = collectCompletionTransitions([t('a')], [t('a', 'done')], empty, 5);
        expect(collectCompletionTransitions([t('a', 'done')], [], retained).has('a')).toBe(false);
    });
});

describe('effectiveViewStatus and settling', () => {
    const retained: RetainedCompletions = new Map([['a', { previousStatus: 'waiting', observedAt: 1000 }]]);
    it('maps retained done tasks to their previous status', () => {
        expect(effectiveViewStatus(t('a', 'done'), retained)).toBe('waiting');
        expect(effectiveViewStatus(t('b', 'done'), retained)).toBe('done');
        expect(effectiveViewStatus(t('a', 'next'), retained)).toBe('next');
    });
    it('settles after the delay', () => {
        expect(getSettledCompletionIds(retained, 1200).has('a')).toBe(false);
        expect(getSettledCompletionIds(retained, 1400).has('a')).toBe(true);
        expect(nextSettleDelay(retained, 1100)).toBe(300);
        expect(nextSettleDelay(retained, 2000)).toBeNull();
    });
});

describe('manual order helpers', () => {
    it('sorts ordered tasks first, unordered keep incoming order', () => {
        const result = sortTasksByManualOrder([
            { id: 'a' }, { id: 'b', boardOrder: 2048 }, { id: 'c', boardOrder: 1024 }, { id: 'd' },
        ] as Array<{ id: string; boardOrder?: number }>, 'boardOrder');
        expect(result.map((x) => x.id)).toEqual(['c', 'b', 'a', 'd']);
    });
    it('reorders for drop before/after', () => {
        expect(reorderIdsForDrop(['a', 'b', 'c', 'd'], 'd', 'a', 'before')).toEqual(['d', 'a', 'b', 'c']);
        expect(reorderIdsForDrop(['a', 'b', 'c', 'd'], 'a', 'c', 'after')).toEqual(['b', 'c', 'a', 'd']);
        expect(reorderIdsForDrop(['a', 'b'], 'a', 'a', 'after')).toEqual(['a', 'b']);
    });
    it('moves to top and by offset', () => {
        expect(moveIdToTop(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b']);
        expect(moveIdByOffset(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
        expect(moveIdByOffset(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
        expect(moveIdByOffset(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c']);
    });
});

describe('retainCompletedInSections', () => {
    const retained: RetainedCompletions = new Map([['b', { previousStatus: 'next', observedAt: 0 }]]);
    const tasks = new Map([['b', t('b', 'done')]]);
    it('keeps a ticked task in its remembered slot while settling, then at the bottom', () => {
        const memory: SectionMembership = new Map();
        retainCompletedInSections({ focus: [t('a'), t('b'), t('c')] }, memory, new Map(), new Set(), (id) => tasks.get(id));
        const settling = retainCompletedInSections({ focus: [t('a'), t('c')] }, memory, retained, new Set(), (id) => tasks.get(id));
        expect(settling.focus.map((x) => x.id)).toEqual(['a', 'b', 'c']);
        const settled = retainCompletedInSections({ focus: [t('a'), t('c')] }, memory, retained, new Set(['b']), (id) => tasks.get(id));
        expect(settled.focus.map((x) => x.id)).toEqual(['a', 'c', 'b']);
    });
    it('forgets tasks that are no longer retained', () => {
        const memory: SectionMembership = new Map();
        retainCompletedInSections({ focus: [t('a'), t('b')] }, memory, new Map(), new Set(), (id) => tasks.get(id));
        const result = retainCompletedInSections({ focus: [t('a')] }, memory, new Map(), new Set(), (id) => tasks.get(id));
        expect(result.focus.map((x) => x.id)).toEqual(['a']);
        expect(memory.has('b')).toBe(false);
    });
});

describe('splitOrderedIdsByStatus', () => {
    it('keeps each status group in the given order and skips unknown ids', () => {
        const status: Record<string, string> = { a: 'next', b: 'inbox', c: 'next', d: 'inbox' };
        expect(splitOrderedIdsByStatus(['c', 'b', 'x', 'a', 'd'], (id) => status[id])).toEqual([
            { status: 'next', ids: ['c', 'a'] },
            { status: 'inbox', ids: ['b', 'd'] },
        ]);
    });
});
