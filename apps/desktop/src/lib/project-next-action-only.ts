import { getProjectFlowMode, tFallback, useTaskStore, type Project, type TranslateFn } from '@stride/core';

import { useUiStore } from '../store/ui-store';
import { reportError } from './report-error';
import { showUndoToast } from './undo-registry';

/** Sets "Next action only" (Project.isSequential) for a project, with Undo back to its previous flow mode. */
export async function setProjectNextActionOnly(project: Project, enabled: boolean, t: TranslateFn): Promise<void> {
    const previousMode = getProjectFlowMode(project);
    const nextMode = enabled ? 'sequential' : 'parallel';
    if (previousMode === nextMode) return;
    const { setProjectFlowMode } = useTaskStore.getState();
    try {
        const result = await setProjectFlowMode(project.id, nextMode);
        if (!result.success) throw new Error(result.error || 'Project not found');
    } catch (error) {
        reportError('Failed to change Next action only', error);
        useUiStore.getState().showToast(tFallback(t, 'task.updateFailed', 'Could not save the change'), 'error');
        return;
    }
    const message = enabled
        ? tFallback(t, 'projects.nextActionOnlyOn', 'Only the next action shows in Focus')
        : tFallback(t, 'projects.nextActionOnlyOff', 'All next actions show in Focus');
    showUndoToast(message, () => {
        void useTaskStore.getState().setProjectFlowMode(project.id, previousMode)
            .catch((error) => reportError('Failed to undo Next action only', error));
    }, t);
}
