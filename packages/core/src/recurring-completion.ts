import { safeFormatDate, safeParseDate } from './date';
import { formatI18nTemplate, translateWithFallback } from './i18n';
import { getRecurrenceCadence, hasRecurrenceRule } from './recurrence';
import { isTaskFinished } from './task-status';
import type { Task } from './types';

/**
 * Completing a repeating task (desktop and menu bar lists):
 *
 * The tick completes this occurrence and the store creates the next one straight away, with the same
 * title. Nothing is wrong with the data, but on screen it can look as if the tick failed, so the views
 * treat it differently from a plain task: the next occurrence stays hidden until the completion sequence
 * ends, the done copy leaves the view instead of waiting at the bottom, and a toast names the next date.
 *
 * A tick on the new occurrence shortly after is most likely the same person checking the tick worked, so
 * it asks before advancing the series again. The check reads the tasks themselves rather than remembering
 * the click, which is what makes it work across windows (main window and menu bar panel).
 *
 * This module holds the pure parts; lib/completion-retention.ts and lib/repeating-completion.ts in the
 * desktop app hold the session state.
 */

/** How long after completing an occurrence a tick on the next one asks first. */
export const RECURRING_TICK_GUARD_MS = 60_000;

type RecurringTask = Pick<Task, 'id' | 'recurrence'>;

export function isRepeatingTask(task: Pick<Task, 'recurrence'>): boolean {
    return hasRecurrenceRule(task.recurrence);
}

/** The first task of a series has no stored seriesId: its own id is what the follow-ups carry. */
export function getRecurrenceSeriesId(task: RecurringTask): string | undefined {
    if (!hasRecurrenceRule(task.recurrence)) return undefined;
    const stored = typeof task.recurrence === 'object' ? task.recurrence?.seriesId?.trim() : undefined;
    return stored || task.id;
}

const isOpenTask = (task: Task): boolean => !task.deletedAt && !isTaskFinished(task);

/** The date an occurrence is scheduled for: the one its row shows first. */
export function getOccurrenceDate(task: Pick<Task, 'dueDate' | 'startTime' | 'reviewAt'>): string | undefined {
    return task.dueDate ?? task.startTime ?? task.reviewAt;
}

const occurrenceTime = (task: Task): number => (
    safeParseDate(getOccurrenceDate(task))?.getTime() ?? Number.POSITIVE_INFINITY
);

/**
 * The open occurrence that follows `completed`: the one its completion generated, else (the store reuses
 * an identical follow-up instead of creating a second one) the earliest open task of the series.
 */
export function findNextOccurrence(tasks: readonly Task[], completed: Task): Task | undefined {
    const seriesId = getRecurrenceSeriesId(completed);
    if (!seriesId) return undefined;
    const open = tasks.filter((task) => (
        task.id !== completed.id && isOpenTask(task) && getRecurrenceSeriesId(task) === seriesId
    ));
    return open.find((task) => task.createdAt === completed.completedAt)
        ?? [...open].sort((a, b) => occurrenceTime(a) - occurrenceTime(b))[0];
}

/** The occurrence of this series completed within the guard window, if any. */
export function findJustCompletedOccurrence(
    tasks: readonly Task[],
    task: Task,
    now: number = Date.now(),
    windowMs: number = RECURRING_TICK_GUARD_MS,
): Task | undefined {
    if (!isOpenTask(task)) return undefined;
    const seriesId = getRecurrenceSeriesId(task);
    if (!seriesId) return undefined;
    return tasks.find((candidate) => {
        if (candidate.id === task.id || candidate.deletedAt || candidate.status !== 'done') return false;
        if (getRecurrenceSeriesId(candidate) !== seriesId) return false;
        const completedAt = safeParseDate(candidate.completedAt)?.getTime();
        return completedAt !== undefined && Math.abs(now - completedAt) < windowMs;
    });
}

type TranslateFn = (key: string) => string;

/** "Done. Repeats next on Sat 14 Nov". */
export function formatRepeatingDoneMessage(t: TranslateFn, occurrence: Pick<Task, 'dueDate' | 'startTime' | 'reviewAt'>): string {
    const date = safeFormatDate(getOccurrenceDate(occurrence), 'EEE d MMM');
    return date
        ? formatI18nTemplate(translateWithFallback(t, 'task.doneRepeatsNext', 'Done. Repeats next on {{date}}'), { date })
        : translateWithFallback(t, 'task.doneRepeats', 'Done. It repeats.');
}

const REPEAT_TICK_PROMPTS = {
    daily: ['task.repeatTick.day', "This repeats. Mark tomorrow's as done too?"],
    weekly: ['task.repeatTick.week', "This repeats. Mark next week's as done too?"],
    monthly: ['task.repeatTick.month', "This repeats. Mark next month's as done too?"],
    yearly: ['task.repeatTick.year', "This repeats. Mark next year's as done too?"],
} as const;

/** The question asked before a second tick advances a series. Names the period only when that is the next one. */
export function formatRepeatTickPrompt(t: TranslateFn, task: Pick<Task, 'recurrence'>): string {
    const cadence = getRecurrenceCadence(task.recurrence);
    const [key, fallback] = cadence && cadence.interval === 1 && cadence.perPeriod === 1
        ? REPEAT_TICK_PROMPTS[cadence.rule]
        : ['task.repeatTick.next', 'This repeats. Mark the next one as done too?'];
    return translateWithFallback(t, key, fallback);
}

export function formatBulkRepeatTickPrompt(t: TranslateFn, count: number): string {
    return formatI18nTemplate(
        translateWithFallback(t, 'task.repeatTick.several', '{{count}} of these repeat. Mark the next ones as done too?'),
        { count },
    );
}
