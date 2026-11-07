import { useSyncExternalStore } from 'react';

import { isMotionEnabled } from './motion';
import { playCompletionSound, prewarmCompletionSound } from './completion-sound';

/**
 * The completion sequence: what a task row does between "the user ticked it" and "it has left its place".
 *
 *   popping  (0ms)      checkbox pops and fills, check draws, ripple, row presses in
 *   struck   (150ms)    strike-through draws left to right, text and chips fade, row flashes success
 *   holding  (600ms)    the row stays put, done, so it can be seen (undo is still one click away)
 *   leaving  (900ms)    the row collapses and fades down; the rows below rise into its place
 *   gone     (1300ms)   the row has left; views that keep done tasks show it at the bottom
 *
 * One controller per window. Rows read their phase with useCompletionPhase; lists treat a task as
 * "settling" (kept in place) while its sequence is active. With Animations off or reduced motion the
 * sequence jumps straight to gone. The phase entry is dropped a moment after gone.
 */
export type CompletionPhase = 'popping' | 'struck' | 'holding' | 'leaving' | 'gone';

export const COMPLETION_TIMELINE = {
    struck: 150,
    holding: 600,
    leaving: 900,
    gone: 1300,
} as const;

/** How long the leaving collapse runs (leaving -> gone). */
export const COMPLETION_LEAVE_MS = COMPLETION_TIMELINE.gone - COMPLETION_TIMELINE.leaving;
/** How long a finished ('gone') entry is kept so rows can play their settle-in. */
export const COMPLETION_GONE_LINGER_MS = 600;
/** Re-ticking (untick) is ignored this long after a tick, so a fast double click never undoes it. */
export const COMPLETION_DOUBLE_CLICK_GUARD_MS = 450;

type Entry = {
    phase: CompletionPhase;
    startedAt: number;
    timers: ReturnType<typeof setTimeout>[];
    /** The row leaves the view when the sequence ends, rather than settling at the bottom (repeating tasks). */
    leavesView?: boolean;
};

const entries = new Map<string, Entry>();

// Any window that can tick tasks loads this module: get the sound ready while idle.
prewarmCompletionSound();
const phaseListeners = new Set<() => void>();
let activeVersion = 0;
let activeIds: ReadonlySet<string> = new Set();

const ACTIVE_PHASES: ReadonlySet<CompletionPhase> = new Set(['popping', 'struck', 'holding', 'leaving']);

function recomputeActive() {
    const next = new Set<string>();
    for (const [id, entry] of entries) if (ACTIVE_PHASES.has(entry.phase)) next.add(id);
    const changed = next.size !== activeIds.size || [...next].some((id) => !activeIds.has(id));
    if (changed) {
        activeIds = next;
        activeVersion += 1;
    }
}

function emit() {
    recomputeActive();
    phaseListeners.forEach((listener) => listener());
}

function clearTimers(entry: Entry) {
    entry.timers.forEach((timer) => clearTimeout(timer));
    entry.timers = [];
}

function setPhase(taskId: string, phase: CompletionPhase) {
    const entry = entries.get(taskId);
    if (!entry || entry.phase === phase) return;
    entry.phase = phase;
    emit();
}

function scheduleDrop(taskId: string, entry: Entry, delay: number) {
    entry.timers.push(setTimeout(() => {
        if (entries.get(taskId) !== entry) return;
        entries.delete(taskId);
        emit();
    }, delay));
}

export type BeginCompletionOptions = {
    /** Play the completion sound (the user ticked it in this window). Default false. */
    sound?: boolean;
};

/**
 * Starts the sequence for a task. Returns false (and does nothing) when a sequence for it is already
 * running, so a double click never completes twice.
 */
export function beginCompletion(taskId: string, options: BeginCompletionOptions = {}): boolean {
    const existing = entries.get(taskId);
    if (existing && ACTIVE_PHASES.has(existing.phase)) return false;
    if (existing) clearTimers(existing);
    if (options.sound) playCompletionSound();
    const entry: Entry = { phase: 'popping', startedAt: Date.now(), timers: [] };
    entries.set(taskId, entry);
    if (!isMotionEnabled()) {
        entry.phase = 'gone';
        scheduleDrop(taskId, entry, 0);
        emit();
        return true;
    }
    const at = (phase: CompletionPhase, delay: number) => {
        entry.timers.push(setTimeout(() => {
            if (entries.get(taskId) !== entry) return;
            setPhase(taskId, phase);
            if (phase === 'gone') scheduleDrop(taskId, entry, COMPLETION_GONE_LINGER_MS);
        }, delay));
    };
    at('struck', COMPLETION_TIMELINE.struck);
    at('holding', COMPLETION_TIMELINE.holding);
    at('leaving', COMPLETION_TIMELINE.leaving);
    at('gone', COMPLETION_TIMELINE.gone);
    emit();
    return true;
}

/** Stops a running sequence (undo, a failed save, the task was reopened elsewhere). */
export function cancelCompletion(taskId: string): void {
    const entry = entries.get(taskId);
    if (!entry) return;
    clearTimers(entry);
    entries.delete(taskId);
    emit();
}

export function getCompletionPhase(taskId: string): CompletionPhase | undefined {
    return entries.get(taskId)?.phase;
}

/** The row goes away when this sequence ends: it stays collapsed at 'gone' instead of settling in. */
export function markCompletionLeavesView(taskId: string): void {
    const entry = entries.get(taskId);
    if (entry) entry.leavesView = true;
}

export function completionLeavesView(taskId: string): boolean {
    return entries.get(taskId)?.leavesView === true;
}

/** True while the row should stay where it is (popping .. leaving). */
export function isCompletionActive(taskId: string): boolean {
    return activeIds.has(taskId);
}

/**
 * Runs `run` when the task's sequence has finished, right away if none is running. A sequence that is
 * cancelled (undo, a failed save) never runs it.
 */
export function afterCompletionSequence(taskId: string, run: () => void): void {
    if (!activeIds.has(taskId)) {
        run();
        return;
    }
    const unsubscribe = subscribeCompletionSequence(() => {
        if (activeIds.has(taskId)) return;
        unsubscribe();
        if (entries.get(taskId)?.phase === 'gone') run();
    });
}

/** True for the first moments of a sequence, when a second click is almost surely a double click. */
export function isWithinDoubleClickGuard(taskId: string, now: number = Date.now()): boolean {
    const entry = entries.get(taskId);
    return Boolean(entry && ACTIVE_PHASES.has(entry.phase) && now - entry.startedAt < COMPLETION_DOUBLE_CLICK_GUARD_MS);
}

export function getActiveCompletionIds(): ReadonlySet<string> {
    return activeIds;
}

export function subscribeCompletionSequence(listener: () => void): () => void {
    phaseListeners.add(listener);
    return () => { phaseListeners.delete(listener); };
}

const getActiveVersion = () => activeVersion;

/** Re-renders when the set of tasks with a running sequence changes (not on every phase step). */
export function useActiveCompletionVersion(): number {
    return useSyncExternalStore(subscribeCompletionSequence, getActiveVersion, getActiveVersion);
}

export function useCompletionPhase(taskId: string): CompletionPhase | undefined {
    return useSyncExternalStore(
        subscribeCompletionSequence,
        () => entries.get(taskId)?.phase,
        () => undefined,
    );
}

export function isActivePhase(phase: CompletionPhase | undefined): boolean {
    return phase !== undefined && ACTIVE_PHASES.has(phase);
}

/** Test helper. */
export function resetCompletionSequenceForTests(): void {
    for (const entry of entries.values()) clearTimers(entry);
    entries.clear();
    emit();
}
