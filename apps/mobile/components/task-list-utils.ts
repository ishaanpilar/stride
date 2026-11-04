
export { buildProjectTaskReorderGroups, flattenProjectReorderGroups, resolveProjectReorderDropPlan, sortProjectTasksByOrder } from '@stride/core';
export type { ProjectTaskReorderListItem, ProjectTaskReorderGroup, ProjectReorderFlatItem, ProjectReorderDropPlan } from '@stride/core';

export const getBulkActionFailureMessage = (error: unknown, fallback: string): string => {
    const message = error instanceof Error ? error.message : String(error ?? '');
    const trimmed = message.trim();
    return trimmed || fallback;
};
