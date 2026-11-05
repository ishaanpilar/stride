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
import {
    beginCompletion,
    cancelCompletion,
    getActiveCompletionIds,
    getCompletionPhase,
    isCompletionActive,
    useActiveCompletionVersion,
} from './completion-sequence';

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
            const previousRetained = retained;
            retained = next;
            syncCompletionSequences(previousRetained, next);
            emit();
        }
    });
}

/**
 * Keeps the completion sequence in step with the store:
 * - a task reopened (undo, untick, another window) stops its sequence, so the row snaps back cleanly;
 * - a single task completed by any other path (keyboard, editor, focus timer, the other window) gets the
 *   same sequence without a sound. Several at once (bulk) stay instant.
 */
function syncCompletionSequences(previous: RetainedCompletions, next: RetainedCompletions) {
    for (const id of previous.keys()) {
        if (!next.has(id) && getCompletionPhase(id) !== undefined) cancelCompletion(id);
    }
    const added: string[] = [];
    for (const id of next.keys()) if (!previous.has(id)) added.push(id);
    if (added.length === 1 && getCompletionPhase(added[0]) === undefined) {
        beginCompletion(added[0]);
    }
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
    /** Retained tasks whose completion sequence has finished, so they may drop to the bottom. */
    settledIds: ReadonlySet<string>;
};

/**
 * Subscribes to the session's completed tasks. A task stays in place while its completion sequence runs
 * (lib/completion-sequence.ts) and is settled once it has finished; tasks completed without a sequence
 * (bulk) settle after the short core delay (immediately when motion is off).
 */
export function useCompletionRetention(): CompletionRetention {
    const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    const activeVersion = useActiveCompletionVersion();
    const [, bump] = useSettleClock(current);
    return useMemo(() => {
        void activeVersion;
        const delay = prefersReducedMotion() ? 0 : COMPLETION_SETTLE_DELAY_MS;
        const settled = getSettledCompletionIds(current, Date.now(), delay);
        const active = getActiveCompletionIds();
        if (active.size > 0) {
            for (const id of active) settled.delete(id);
        }
        // A sequence that ended counts as settled even if the core delay has not (cannot, in practice) passed.
        for (const id of current.keys()) {
            if (!settled.has(id) && !isCompletionActive(id) && getCompletionPhase(id) === 'gone') settled.add(id);
        }
        return { retained: current, settledIds: settled };
    }, [current, bump, activeVersion]);
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
