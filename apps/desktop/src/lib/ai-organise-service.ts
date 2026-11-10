import {
    applyProjectOrderProposal,
    applyTaskGrouping,
    useTaskStore,
    type ApplyProjectOrderResult,
    type ApplyTaskGroupingResult,
    type ProjectOrderProposal,
    type ProjectOrderSelection,
    type TaskGroupingGroup,
} from '@stride/core';

import { trackAiPlacement } from './ai-routing';
import { assistantChangeLog, createStoreAssistantPort } from './assistant-service';

/** Applies "Order this project" and "Group these" as ONE change-log entry each, with one undo. */

export type AppliedAiOrganise<T> = T & { changeId: string | null };

export async function applyProjectOrderSelection(
    proposal: ProjectOrderProposal,
    selection: ProjectOrderSelection,
    label: string,
): Promise<AppliedAiOrganise<ApplyProjectOrderResult>> {
    const result = await applyProjectOrderProposal(proposal, selection, createStoreAssistantPort());
    if (result.undoOps.length === 0) return { ...result, changeId: null };
    const entry = assistantChangeLog.record(`project-order:${Date.now()}`, 'order_project', {
        label,
        kind: 'plan',
        details: result.changes.slice(0, 20).map((change) => change.title),
        undoOps: result.undoOps,
        changes: result.changes,
    });
    return { ...result, changeId: entry.id };
}

export async function applyLooseGrouping(
    groups: readonly TaskGroupingGroup[],
    label: string,
): Promise<AppliedAiOrganise<ApplyTaskGroupingResult>> {
    const result = await applyTaskGrouping(groups, createStoreAssistantPort());
    if (result.undoOps.length === 0) return { ...result, changeId: null };
    const entry = assistantChangeLog.record(`loose-grouping:${Date.now()}`, 'group_loose_tasks', {
        label,
        kind: 'plan',
        details: result.changes.slice(0, 20).map((change) => change.title),
        undoOps: result.undoOps,
        changes: result.changes,
    });
    const { _allTasks } = useTaskStore.getState();
    for (const id of result.movedTaskIds) {
        const task = _allTasks.find((candidate) => candidate.id === id);
        if (task?.projectId) trackAiPlacement(id, { title: task.title, projectId: task.projectId, areaId: task.areaId });
    }
    return { ...result, changeId: entry.id };
}

export async function undoAiOrganise(changeId: string): Promise<boolean> {
    const outcome = await assistantChangeLog.undo(changeId, createStoreAssistantPort());
    return outcome.ok;
}

// --- Banner dismissal (per device) ---------------------------------------------------------------

export const LOOSE_GROUPING_DISMISSED_KEY = 'stride:focus:loose-grouping-dismissed:v1';

export function readLooseGroupingDismissedCount(): number | null {
    try {
        const raw = localStorage.getItem(LOOSE_GROUPING_DISMISSED_KEY);
        if (raw === null) return null;
        const count = Number(raw);
        return Number.isInteger(count) && count >= 0 ? count : null;
    } catch {
        return null;
    }
}

export function dismissLooseGrouping(looseCount: number): void {
    try {
        localStorage.setItem(LOOSE_GROUPING_DISMISSED_KEY, String(looseCount));
    } catch {
        // A convenience only: the banner simply comes back.
    }
}
