import {
    getFocusStarBlockedText,
    normalizeFocusTaskLimit,
    sortTasksByFocusOrder,
    tFallback,
    useTaskStore,
    type TranslateFn,
} from '@stride/core';
import { useUiStore } from '../store/ui-store';
import { reportError } from './report-error';
import { showUndoToast } from './undo-registry';

export function focusDropBlockedReason(taskId: string, t: TranslateFn): string | null {
    const store = useTaskStore.getState();
    const task = store._tasksById.get(taskId);
    if (!task) return tFallback(t, 'list.reorder.cannotDropHere', "Can't move here");
    if (task.isFocusedToday) return null;
    const action = store.getFocusStarAction(task, { promoteInbox: true });
    if (action.canToggle) return null;
    return getFocusStarBlockedText(t, action, normalizeFocusTaskLimit(store.settings?.gtd?.focusTaskLimit))
        ?? tFallback(t, 'list.reorder.cannotDropHere', "Can't move here");
}

export async function addTaskToFocusFromDrop(
    taskId: string,
    t: TranslateFn,
    placeInFocusOrder?: (focusIds: string[]) => string[],
): Promise<boolean> {
    const store = useTaskStore.getState();
    const task = store._tasksById.get(taskId);
    if (!task || task.isFocusedToday) return false;
    const blocked = focusDropBlockedReason(taskId, t);
    if (blocked) {
        useUiStore.getState().showToast(blocked, 'info');
        return false;
    }
    const action = store.getFocusStarAction(task, { promoteInbox: true });
    const previousStatus = task.status;
    const promoted = action.patch.status !== undefined && action.patch.status !== previousStatus;
    try {
        const result = await store.updateTask(taskId, action.patch);
        if (result && result.success === false) throw new Error(result.error || 'Failed to add task to Focus');
        if (placeInFocusOrder) {
            const latest = useTaskStore.getState();
            const focusIds = sortTasksByFocusOrder(latest.getDerivedState().focusedTasks).map((focused) => focused.id);
            const ordered = placeInFocusOrder(focusIds);
            if (ordered.length > 0) await latest.reorderFocusedTasks(ordered);
        }
    } catch (error) {
        reportError('Failed to add task to Focus', error);
        useUiStore.getState().showToast(tFallback(t, 'task.updateFailed', 'Could not update task.'), 'error');
        return false;
    }
    showUndoToast(tFallback(t, 'agenda.addedToFocus', "Added to Today's Focus"), () => {
        void Promise.resolve(useTaskStore.getState().updateTask(taskId, {
            isFocusedToday: false,
            ...(promoted ? { status: previousStatus } : {}),
        })).catch((error) => reportError('Failed to undo adding a task to Focus', error));
    }, t);
    return true;
}
