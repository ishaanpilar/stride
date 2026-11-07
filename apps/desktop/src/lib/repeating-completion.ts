import {
    findJustCompletedOccurrence,
    findNextOccurrence,
    formatBulkRepeatTickPrompt,
    formatRepeatingDoneMessage,
    formatRepeatTickPrompt,
    getTranslator,
    isRepeatingTask,
    isTaskFinished,
    translateWithFallback,
    useTaskStore,
    type Task,
    type TranslateFn,
} from '@stride/core';
import { useSyncExternalStore } from 'react';

import { getCurrentUiLanguage } from '../contexts/language-context';
import { useUiStore } from '../store/ui-store';
import { afterCompletionSequence } from './completion-sequence';
import { reportError } from './report-error';
import { registerUndoableAction } from './undo-registry';

/**
 * What the user sees around a repeating task's tick: the "Done. Repeats next on ..." message with its
 * Stop repeating action, and the check before a second tick advances the series (the rules are in core
 * recurring-completion.ts). Hiding and highlighting the new occurrence is in completion-retention.ts.
 */

const REPEATING_TOAST_MS = 7000;
const BULK_CONFIRM_TOAST_MS = 12000;
/** An unanswered question means no: it does not wait for a row that may have left the screen. */
const REPEAT_TICK_ASK_MS = 30_000;

export type RepeatingCompletion = { message: string; occurrenceId: string };

/** Null unless the task repeats and an open next occurrence exists: then a plain "marked Done" is right. */
export function describeRepeatingCompletion(taskId: string, t: TranslateFn): RepeatingCompletion | null {
    const state = useTaskStore.getState();
    const task = state._tasksById.get(taskId);
    if (!task || !isRepeatingTask(task)) return null;
    const occurrence = findNextOccurrence(state._allTasks, task);
    return occurrence ? { message: formatRepeatingDoneMessage(t, occurrence), occurrenceId: occurrence.id } : null;
}

async function assertSaved(result: Promise<{ success: boolean; error?: string }> | { success: boolean; error?: string }, fallback: string) {
    const outcome = await result;
    if (outcome && outcome.success === false) throw new Error(outcome.error || fallback);
}

/**
 * Ends the series: the next occurrence loses its recurrence and goes to Trash, so nothing is left in the
 * future. Returns what puts it back. If that occurrence has been completed since the toast appeared, it
 * stays in History and the stop applies to the one after it.
 */
export async function stopRepeatingOccurrence(occurrenceId: string): Promise<() => Promise<void>> {
    const state = useTaskStore.getState();
    const named = state._tasksById.get(occurrenceId);
    const target = named && isTaskFinished(named) ? findNextOccurrence(state._allTasks, named) : named;
    if (!target) return async () => undefined;
    const { id, recurrence } = target;
    await assertSaved(state.updateTask(id, { recurrence: undefined }), 'Failed to stop repeating');
    await assertSaved(useTaskStore.getState().deleteTask(id), 'Failed to stop repeating');
    return async () => {
        await assertSaved(useTaskStore.getState().restoreTask(id), 'Failed to restore the next occurrence');
        await assertSaved(useTaskStore.getState().updateTask(id, { recurrence }), 'Failed to restore the repeat');
    };
}

function stopRepeatingFromToast(occurrenceId: string, t: TranslateFn) {
    void stopRepeatingOccurrence(occurrenceId)
        .then((restore) => {
            const undo = registerUndoableAction(() => {
                void restore().catch((error) => reportError('Failed to undo stop repeating', error));
            });
            useUiStore.getState().showToast(
                translateWithFallback(t, 'task.repeatStopped', 'Stopped repeating'),
                'info',
                5000,
                { label: translateWithFallback(t, 'common.undo', 'Undo'), onClick: undo },
            );
        })
        .catch((error) => reportError('Failed to stop repeating', error));
}

/**
 * Shows the repeating version of the "completed" toast once the sequence has played. Returns false, doing
 * nothing, when the task needs the plain toast. The message is not an undo notification: with those
 * turned off it still appears, only without Undo.
 */
export function showRepeatingDoneToast(taskId: string, options: { undo: () => void; t: TranslateFn }): boolean {
    const { undo, t } = options;
    const completion = describeRepeatingCompletion(taskId, t);
    if (!completion) return false;
    afterCompletionSequence(taskId, () => {
        const undoEnabled = useTaskStore.getState().settings?.undoNotificationsEnabled !== false;
        const stop = {
            label: translateWithFallback(t, 'task.stopRepeating', 'Stop repeating'),
            onClick: () => stopRepeatingFromToast(completion.occurrenceId, t),
        };
        useUiStore.getState().showToast(
            completion.message,
            'info',
            REPEATING_TOAST_MS,
            undoEnabled ? { label: translateWithFallback(t, 'common.undo', 'Undo'), onClick: undo } : stop,
            undoEnabled ? stop : undefined,
        );
    });
    return true;
}

/** The tick guard's open question: one row at a time, answered inline in that row. */
let pending: { taskId: string; proceed: () => void; timer: ReturnType<typeof setTimeout> } | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};

const liveTask = (taskId: string): Task | undefined => useTaskStore.getState()._tasksById.get(taskId);

/** True when ticking this task would advance a series the user completed moments ago. */
export function needsRepeatTickConfirm(taskId: string, now: number = Date.now()): boolean {
    const task = liveTask(taskId);
    return Boolean(task && findJustCompletedOccurrence(useTaskStore.getState()._allTasks, task, now));
}

/** Runs `proceed` now, or asks in the task's row first when the tick may be an accidental repeat. */
export function guardRepeatTick(taskId: string, proceed: () => void): void {
    if (!needsRepeatTickConfirm(taskId)) {
        proceed();
        return;
    }
    if (pending) clearTimeout(pending.timer);
    pending = { taskId, proceed, timer: setTimeout(() => answerRepeatTick(taskId, false), REPEAT_TICK_ASK_MS) };
    emit();
}

export function answerRepeatTick(taskId: string, confirmed: boolean): void {
    if (pending?.taskId !== taskId) return;
    const { proceed, timer } = pending;
    clearTimeout(timer);
    pending = null;
    emit();
    if (confirmed) proceed();
}

export function useRepeatTickPending(taskId: string): boolean {
    return useSyncExternalStore(subscribe, () => pending?.taskId === taskId, () => false);
}

export function splitRepeatTickGuarded(taskIds: readonly string[]): { clear: string[]; guarded: string[] } {
    const now = Date.now();
    const guarded = taskIds.filter((id) => needsRepeatTickConfirm(id, now));
    return { clear: taskIds.filter((id) => !guarded.includes(id)), guarded };
}

/** No single row to ask in (bulk, a drag onto the sidebar): the same question, as a toast. */
export function askRepeatTickInToast(taskIds: readonly string[], onConfirm: () => void, t?: TranslateFn): void {
    const translate = t ?? getTranslator(useTaskStore.getState().settings?.language || getCurrentUiLanguage());
    const single = taskIds.length === 1 ? liveTask(taskIds[0]) : undefined;
    useUiStore.getState().showToast(
        single ? formatRepeatTickPrompt(translate, single) : formatBulkRepeatTickPrompt(translate, taskIds.length),
        'info',
        BULK_CONFIRM_TOAST_MS,
        { label: translateWithFallback(translate, 'task.repeatTick.yes', 'Yes'), onClick: onConfirm },
        { label: translateWithFallback(translate, 'common.cancel', 'Cancel'), onClick: () => undefined },
    );
}

/** Test helper. */
export function resetRepeatTickGuardForTests(): void {
    if (pending) clearTimeout(pending.timer);
    pending = null;
    emit();
}
