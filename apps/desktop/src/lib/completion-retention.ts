import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
    COMPLETION_SETTLE_DELAY_MS,
    collectCompletionTransitions,
    getSettledCompletionIds,
    nextSettleDelay,
    useTaskStore,
    type RetainedCompletions,
    type TaskStatus,
} from '@stride/core';

import { isMotionEnabled } from './motion';

/**
 * Session tracker for "ticked done tasks stay visible" (see packages/core task-completion-order.ts for the
 * rule). It watches the task store for open -> done transitions made in this app session and remembers
 * the status each task had, so status-based lists can keep showing it, struck through, at the bottom.
 */

let retained: RetainedCompletions = new Map();
let tracking = false;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());

function startTracking() {
    if (tracking) return;
    tracking = true;
    useTaskStore.subscribe((state, previous) => {
        if (state._allTasks === previous._allTasks && state.tasks === previous.tasks) return;
        const source = state._allTasks?.length ? state._allTasks : state.tasks;
        const before = previous._allTasks?.length ? previous._allTasks : previous.tasks;
        const next = collectCompletionTransitions(before, source, retained);
        if (next !== retained) {
            retained = next;
            emit();
        }
    });
}

startTracking();

const subscribe = (listener: () => void) => {
    startTracking();
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};
const getSnapshot = () => retained;

export function prefersReducedMotion(): boolean {
    return !isMotionEnabled();
}

/** Test helper: forget everything tracked so far. */
export function resetCompletionRetentionForTests() {
    retained = new Map();
    emit();
}

export type CompletionRetention = {
    /** Done tasks completed this session, keyed by id, with the status they were ticked from. */
    retained: RetainedCompletions;
    /** Retained tasks whose tick animation has finished, so they may drop to the bottom. */
    settledIds: ReadonlySet<string>;
};

/**
 * Subscribes to the session's completed tasks. Re-renders once more when the next tick settles (about
 * 400ms; immediately under prefers-reduced-motion).
 */
export function useCompletionRetention(): CompletionRetention {
    const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    const [, bump] = useSettleClock(current);
    return useMemo(() => {
        const delay = prefersReducedMotion() ? 0 : COMPLETION_SETTLE_DELAY_MS;
        return { retained: current, settledIds: getSettledCompletionIds(current, Date.now(), delay) };
    }, [current, bump]);
}

function useSettleClock(current: RetainedCompletions): [void, number] {
    const [tick, setTick] = useState(0);
    useEffect(() => {
        if (prefersReducedMotion()) return;
        const wait = nextSettleDelay(current, Date.now(), COMPLETION_SETTLE_DELAY_MS);
        if (wait === null) return;
        const timer = setTimeout(() => setTick((value) => value + 1), wait + 5);
        return () => clearTimeout(timer);
    }, [current, tick]);
    return [undefined, tick];
}

/** Status a task was ticked from this session (undefined when it was not completed in this session). */
export function useRetainedPreviousStatus(taskId: string): TaskStatus | undefined {
    return useSyncExternalStore(
        subscribe,
        () => retained.get(taskId)?.previousStatus,
        () => undefined,
    );
}
