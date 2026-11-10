import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Task } from '@stride/core';
import { useTaskStore } from '@stride/core';
import {
    buildUnblockedToastMessage,
    collectLocallyCompletedIds,
    startDependencyUnblockNotifier,
} from './dependency-unblock-notifier';

const NOW = '2026-11-08T10:00:00.000Z';
const task = (id: string, extra: Partial<Task> = {}): Task => ({
    id, title: id, status: 'next', tags: [], contexts: [], createdAt: NOW, updatedAt: NOW, ...extra,
}) as Task;
const identity = (key: string) => key;

describe('unblock toast message', () => {
    const blocker = task('Blocker');
    const dependent = task('Dependent', { blockedByTaskIds: ['Blocker'] });
    const other = task('Other', { blockedByTaskIds: ['Blocker'] });

    it('summarises several unblocked tasks in one toast', () => {
        const next = [{ ...blocker, status: 'done' as const, revBy: 'device' }, dependent, other];
        expect(buildUnblockedToastMessage([blocker, dependent, other], next, 'device', identity)).toBe('Unblocked: Dependent +1');
    });

    it('stays quiet when another blocker is still open', () => {
        const second = task('Second');
        const stuck = task('Stuck', { blockedByTaskIds: ['Blocker', 'Second'] });
        const next = [{ ...blocker, status: 'done' as const, revBy: 'device' }, second, stuck];
        expect(buildUnblockedToastMessage([blocker, second, stuck], next, 'device', identity)).toBeNull();
    });

    it('ignores completions from other devices and tasks with no dependents', () => {
        expect(buildUnblockedToastMessage([blocker, dependent], [{ ...blocker, status: 'done', revBy: 'other' }, dependent], 'device', identity)).toBeNull();
        expect(buildUnblockedToastMessage([blocker, task('Free')], [{ ...blocker, status: 'done' as const }, task('Free')], 'device', identity)).toBeNull();
    });

    it('only counts a real status change to done', () => {
        const completedBefore = { ...blocker, status: 'done' as const };
        expect(collectLocallyCompletedIds([completedBefore], [completedBefore], 'device')).toEqual(new Set());
    });
});

describe('startDependencyUnblockNotifier', () => {
    let stop: () => void;
    const messages: string[] = [];

    const seed = (tasks: Task[]) => useTaskStore.setState({ _allTasks: tasks, tasks, _tasksById: new Map(tasks.map((t) => [t.id, t])), settings: { deviceId: 'device' } });

    beforeEach(() => {
        messages.length = 0;
        seed([task('Blocker'), task('Dependent', { blockedByTaskIds: ['Blocker'] })]);
        stop = startDependencyUnblockNotifier({ translate: identity, showToast: (message) => messages.push(message) });
    });

    afterEach(() => stop());

    const setStatus = (status: Task['status']) => {
        const current = useTaskStore.getState()._allTasks;
        const next = current.map((t) => (t.id === 'Blocker' ? { ...t, status, revBy: 'device' } : t));
        seed(next);
    };

    it('toasts once when the blocker completes and the undo re-blocks silently', () => {
        setStatus('done');
        expect(messages).toEqual(['Unblocked: Dependent']);
        setStatus('next');
        expect(messages).toEqual(['Unblocked: Dependent']);
    });
});
