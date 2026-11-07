import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
    COMPLETION_SETTLE_DELAY_MS,
    collectCompletionTransitions,
    findNextOccurrence,
    getSettledCompletionIds,
    isRepeatingTask,
    nextSettleDelay,
    useTaskStore,
    type RetainedCompletions,
    type Task,
    type TaskStatus,
} from '@stride/core';

import { isMotionEnabled } from './motion';
import {
    beginCompletion,
    cancelCompletion,
    getActiveCompletionIds,
    getCompletionPhase,
    isCompletionActive,
    markCompletionLeavesView,
    subscribeCompletionSequence,
    useActiveCompletionVersion,
} from './completion-sequence';

/**
 * Session tracker for "ticked done tasks stay visible" (see packages/core task-completion-order.ts for the
 * rule). It watches the task store for open -> done transitions made in this app session and remembers
 * the status each task had, so status-based lists can keep showing it, struck through, at the bottom.
 *
 * Repeating tasks (core recurring-completion.ts) differ: the occurrence the tick generated is held back
 * from the views until the sequence ends, the done copy is then forgotten here so it leaves the view, and
 * the new occurrence is flagged as arrived for a moment so its row can highlight.
 */

/** How long a new occurrence's row keeps its highlight. Keep in step with styles/motion.css. */
export const OCCURRENCE_ARRIVAL_MS = 1600;

type RepeatingCompletion = {
    /** The occurrence held back while this one completes; null when none is new to the views. */
    heldId: string | null;
    observedAt: number;
};

let retained: RetainedCompletions = new Map();
const repeating = new Map<string, RepeatingCompletion>();
let heldIds: ReadonlySet<string> = new Set();
const arrivals = new Map<string, ReturnType<typeof setTimeout>>();
let settleTimer: ReturnType<typeof setTimeout> | null = null;
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
            trackRepeatingCompletions(previousRetained, next, before, source);
            syncCompletionSequences(previousRetained, next);
            for (const id of repeating.keys()) markCompletionLeavesView(id);
            settleRepeatingCompletions();
            emit();
        }
    });
    subscribeCompletionSequence(settleRepeatingCompletions);
}

function setHeld(update: (ids: Set<string>) => void) {
    const next = new Set(heldIds);
    update(next);
    heldIds = next;
}

/** Notes which new completions repeat and holds back what they generated; forgets the ones undone. */
function trackRepeatingCompletions(
    previous: RetainedCompletions,
    next: RetainedCompletions,
    before: readonly Task[],
    source: readonly Task[],
) {
    for (const id of previous.keys()) {
        if (next.has(id) || !repeating.has(id)) continue;
        const heldId = repeating.get(id)?.heldId;
        repeating.delete(id);
        if (heldId) setHeld((ids) => ids.delete(heldId));
    }
    const added = [...next.keys()].filter((id) => !previous.has(id));
    if (added.length === 0) return;
    const existedBefore = new Set(before.map((task) => task.id));
    for (const id of added) {
        const task = source.find((candidate) => candidate.id === id);
        if (!task || !isRepeatingTask(task)) continue;
        const occurrence = findNextOccurrence(source, task);
        const heldId = occurrence && !existedBefore.has(occurrence.id) ? occurrence.id : null;
        repeating.set(id, { heldId, observedAt: Date.now() });
        if (heldId) setHeld((ids) => ids.add(heldId));
    }
}

/**
 * Ends the repeating completions whose moment has passed: when the sequence ended, or, without a sequence
 * (bulk), after the same settle delay plain tasks get before they move.
 */
function settleRepeatingCompletions() {
    if (repeating.size === 0) return;
    const delay = prefersReducedMotion() ? 0 : COMPLETION_SETTLE_DELAY_MS;
    const now = Date.now();
    const finished: string[] = [];
    let wait: number | null = null;
    for (const [id, entry] of repeating) {
        if (isCompletionActive(id)) continue;
        const remaining = getCompletionPhase(id) === 'gone' ? 0 : entry.observedAt + delay - now;
        if (remaining <= 0) finished.push(id);
        else wait = wait === null ? remaining : Math.min(wait, remaining);
    }
    if (settleTimer !== null) clearTimeout(settleTimer);
    settleTimer = wait === null ? null : setTimeout(settleRepeatingCompletions, wait + 5);
    if (finished.length === 0) return;
    const nextRetained = new Map(retained);
    for (const id of finished) {
        const heldId = repeating.get(id)?.heldId;
        repeating.delete(id);
        nextRetained.delete(id);
        if (!heldId) continue;
        setHeld((ids) => ids.delete(heldId));
        markArrived(heldId);
    }
    retained = nextRetained;
    emit();
}

function markArrived(taskId: string) {
    const running = arrivals.get(taskId);
    if (running) clearTimeout(running);
    arrivals.set(taskId, setTimeout(() => {
        arrivals.delete(taskId);
        emit();
    }, OCCURRENCE_ARRIVAL_MS));
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
const getHeldIds = () => heldIds;

export function prefersReducedMotion(): boolean {
    return !isMotionEnabled();
}

/** Test helper: forget everything tracked so far. */
export function resetCompletionRetentionForTests() {
    retained = new Map();
    repeating.clear();
    heldIds = new Set();
    arrivals.forEach((timer) => clearTimeout(timer));
    arrivals.clear();
    if (settleTimer !== null) clearTimeout(settleTimer);
    settleTimer = null;
    emit();
}

export type CompletionRetention = {
    /** Done tasks completed this session, keyed by id, with the status they were ticked from. */
    retained: RetainedCompletions;
    /** Retained tasks whose completion sequence has finished, so they may drop to the bottom. */
    settledIds: ReadonlySet<string>;
    /** New occurrences of repeating tasks, kept out of the views while the previous one completes. */
    heldIds: ReadonlySet<string>;
};

/**
 * Subscribes to the session's completed tasks. A task stays in place while its completion sequence runs
 * (lib/completion-sequence.ts) and is settled once it has finished; tasks completed without a sequence
 * (bulk) settle after the short core delay (immediately when motion is off).
 */
export function useCompletionRetention(): CompletionRetention {
    const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    const held = useHeldOccurrenceIds();
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
        return { retained: current, settledIds: settled, heldIds: held };
    }, [current, held, bump, activeVersion]);
}

/** For views that only need to keep a new occurrence back (see CompletionRetention.heldIds). */
export function useHeldOccurrenceIds(): ReadonlySet<string> {
    return useSyncExternalStore(subscribe, getHeldIds, getHeldIds);
}

/** True for the moment after a new occurrence appears, so its row can highlight. */
export function useOccurrenceArrived(taskId: string): boolean {
    return useSyncExternalStore(subscribe, () => arrivals.has(taskId), () => false);
}

/** True while the done copy of a repeating task is still on screen (its sequence is playing). */
export function isRepeatingCompletionPending(taskId: string): boolean {
    return repeating.has(taskId);
}

/** Status a task was ticked from this session, outside React. */
export function getRetainedPreviousStatus(taskId: string): TaskStatus | undefined {
    return retained.get(taskId)?.previousStatus;
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
