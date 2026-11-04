import type { Task } from './types';
import { safeParseDate } from './date';
import { timeEstimateToMinutes } from './calendar-scheduling';
import { isTaskCancelled } from './task-status';

export interface TodayProgress {
    /** Tasks due or planned (start date) today, still open or completed today. */
    total: number;
    /** Of those, how many are done. */
    done: number;
    /** total - done. */
    left: number;
    /** Sum of time estimates (minutes) of the remaining tasks that have one. 0 when none. */
    remainingMinutes: number;
    /** 0..1 fraction done (0 when total is 0). */
    fraction: number;
}

const isSameLocalDay = (value: string | undefined, now: Date): boolean => {
    const parsed = safeParseDate(value);
    return Boolean(parsed)
        && parsed!.getFullYear() === now.getFullYear()
        && parsed!.getMonth() === now.getMonth()
        && parsed!.getDate() === now.getDate();
};

/**
 * Progress for "today": tasks due or planned today, split into done and remaining.
 * A finished task only counts when it was completed today, so yesterday's work does not inflate the total.
 */
export function getTodayProgress(tasks: readonly Task[], now: Date = new Date()): TodayProgress {
    let total = 0;
    let done = 0;
    let remainingMinutes = 0;
    for (const task of tasks) {
        if (task.deletedAt || task.status === 'reference' || isTaskCancelled(task)) continue;
        if (!isSameLocalDay(task.dueDate, now) && !isSameLocalDay(task.startTime, now)) continue;
        const finished = task.status === 'done' || task.status === 'archived';
        if (finished) {
            if (!isSameLocalDay(task.completedAt ?? task.updatedAt, now)) continue;
            total += 1;
            done += 1;
            continue;
        }
        total += 1;
        if (task.timeEstimate) remainingMinutes += timeEstimateToMinutes(task.timeEstimate);
    }
    return {
        total,
        done,
        left: total - done,
        remainingMinutes,
        fraction: total > 0 ? done / total : 0,
    };
}

/** "2 h 10 m", "45 m", "3 h". Empty string for zero or invalid minutes. */
export function formatRemainingDuration(minutes: number): string {
    if (!Number.isFinite(minutes) || minutes <= 0) return '';
    const rounded = Math.round(minutes);
    const hours = Math.floor(rounded / 60);
    const mins = rounded % 60;
    if (hours && mins) return `${hours} h ${mins} m`;
    if (hours) return `${hours} h`;
    return `${mins} m`;
}
