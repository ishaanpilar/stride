import {
    createTaskLookup,
    formatUnblockedToast,
    getTasksUnblockedByResolving,
    useTaskStore,
    type Task,
} from '@stride/core';
import { useUiStore } from '../store/ui-store';

const UNBLOCKED_TOAST_MS = 6000;

export type UnblockNotifierDeps = {
    showToast: (message: string) => void;
    translate: (key: string) => string;
};

export function collectLocallyCompletedIds(
    previous: readonly Task[],
    next: readonly Task[],
    deviceId: string | undefined,
): Set<string> {
    const previousById = createTaskLookup(previous);
    const completed = new Set<string>();
    for (const task of next) {
        if (task.status !== 'done' || (deviceId && task.revBy && task.revBy !== deviceId)) continue;
        const before = previousById.get(task.id);
        if (before && before.status !== 'done' && !task.deletedAt) completed.add(task.id);
    }
    return completed;
}

export function buildUnblockedToastMessage(
    previous: readonly Task[],
    next: readonly Task[],
    deviceId: string | undefined,
    translate: (key: string) => string,
): string | null {
    if (!previous.some((task) => task.blockedByTaskIds?.length)) return null;
    const completedIds = collectLocallyCompletedIds(previous, next, deviceId);
    if (completedIds.size === 0) return null;
    const unblocked = getTasksUnblockedByResolving(completedIds, previous, createTaskLookup(previous));
    return unblocked.length > 0 ? formatUnblockedToast(unblocked, translate) : null;
}

export function startDependencyUnblockNotifier(deps: UnblockNotifierDeps): () => void {
    let previous = useTaskStore.getState()._allTasks;
    return useTaskStore.subscribe((state) => {
        const next = state._allTasks;
        if (next === previous) return;
        const before = previous;
        previous = next;
        const message = buildUnblockedToastMessage(before, next, state.settings?.deviceId, deps.translate);
        if (message) deps.showToast(message);
    });
}

export function startDesktopDependencyUnblockNotifier(translate: (key: string) => string): () => void {
    return startDependencyUnblockNotifier({
        translate,
        showToast: (message) => useUiStore.getState().showToast(message, 'info', UNBLOCKED_TOAST_MS),
    });
}
