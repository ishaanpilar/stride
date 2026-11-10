import { getOpenBlockers, hasTaskBlockers, isBlockerOpen, formatWaitsForLabel, type Task, useTaskStore } from '@stride/core';

export function useTaskWaitsForLabel(task: Task, t: (key: string) => string): string | null {
    return useTaskStore((state) => {
        if (!hasTaskBlockers(task) || !isBlockerOpen(task)) return null;
        const open = getOpenBlockers(task, state._tasksById);
        return open.length > 0 ? formatWaitsForLabel(open, t) : null;
    });
}
