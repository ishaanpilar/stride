import {
    ROUTING_CORRECTIONS_STORAGE_KEY,
    buildRoutingContext,
    parseRoutingCorrections,
    recordRoutingCorrection,
    serializeRoutingCorrections,
    useTaskStore,
    type ChangeEntry,
    type RoutingCorrection,
    type Task,
} from '@stride/core';

/**
 * Desktop glue for AI routing: the local (unsynced) correction log in localStorage, the bounded
 * routing context built from the live store, and a small in-memory tracker that notices when the
 * user moves something the AI placed, so the next prompt can learn from it.
 */

const storage = (): Storage | null => {
    try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
};

export function loadRoutingCorrections(): RoutingCorrection[] {
    try { return parseRoutingCorrections(storage()?.getItem(ROUTING_CORRECTIONS_STORAGE_KEY)); } catch { return []; }
}

export function saveRoutingCorrection(entry: Omit<RoutingCorrection, 'at'> & { at?: string }): void {
    const store = storage();
    if (!store) return;
    try {
        const next = recordRoutingCorrection(loadRoutingCorrections(), { ...entry, at: entry.at ?? new Date().toISOString() });
        store.setItem(ROUTING_CORRECTIONS_STORAGE_KEY, serializeRoutingCorrections(next));
    } catch {
        // Corrections are a convenience; never let storage problems break capture or the Assistant.
    }
}

/** Routing context from the live store plus local corrections. */
export function buildDesktopRoutingContext(): string {
    const { areas, projects, people } = useTaskStore.getState();
    return buildRoutingContext({ areas, projects, people, corrections: loadRoutingCorrections() }).text;
}

// ---- tracker -----------------------------------------------------------------------------

type Placement = { title: string; areaId?: string; projectId?: string };
const TRACK_MAX = 300;
const tracked = new Map<string, Placement>();
let unsubscribe: (() => void) | null = null;

const effectiveAreaId = (task: Pick<Task, 'projectId' | 'areaId'>, projectAreas: Map<string, string | undefined>): string | undefined =>
    (task.projectId ? projectAreas.get(task.projectId) : undefined) ?? task.areaId;

function ensureSubscribed(): void {
    if (unsubscribe) return;
    unsubscribe = useTaskStore.subscribe((state, prev) => {
        if (tracked.size === 0 || state._allTasks === prev._allTasks) return;
        const tasks = new Map(state._allTasks.map((task) => [task.id, task]));
        const projectAreas = new Map(state._allProjects.map((project) => [project.id, project.areaId]));
        const projectTitle = (id?: string) => (id ? state._allProjects.find((p) => p.id === id)?.title : undefined);
        const areaName = (id?: string) => (id ? state._allAreas.find((a) => a.id === id)?.name : undefined);
        for (const [taskId, placement] of [...tracked.entries()]) {
            const task = tasks.get(taskId);
            if (!task || task.deletedAt || task.purgedAt) { tracked.delete(taskId); continue; }
            const area = effectiveAreaId(task, projectAreas);
            const placedArea = placement.projectId ? projectAreas.get(placement.projectId) ?? placement.areaId : placement.areaId;
            if ((task.projectId ?? undefined) === placement.projectId && area === placedArea) continue;
            tracked.delete(taskId);
            if (!area && !task.projectId) continue; // moved to "nowhere": nothing to learn
            saveRoutingCorrection({
                text: task.title || placement.title,
                fromArea: areaName(placedArea),
                fromProject: projectTitle(placement.projectId),
                toArea: areaName(area),
                toProject: projectTitle(task.projectId),
            });
        }
    });
}

/** Remember where the AI put a task; a later user move becomes a routing correction. */
export function trackAiPlacement(taskId: string, placement: Placement): void {
    if (!placement.areaId && !placement.projectId) return;
    tracked.set(taskId, placement);
    while (tracked.size > TRACK_MAX) tracked.delete(tracked.keys().next().value as string);
    ensureSubscribed();
}

export function untrackAiPlacements(taskIds: Iterable<string>): void {
    for (const id of taskIds) tracked.delete(id);
}

export function isAiPlacementTracked(taskId: string): boolean {
    return tracked.has(taskId);
}

const seenEntries = new Set<string>();

/**
 * Keep the tracker in sync with the Assistant change log: routed task changes are tracked, and
 * anything the user undid through the Assistant is forgotten (an undo is not a correction).
 */
export function syncAssistantPlacements(entries: readonly ChangeEntry[]): void {
    for (const entry of entries) {
        const taskIds = entry.changes.map((c) => c.taskId);
        if (entry.undone) { untrackAiPlacements(taskIds); continue; }
        if (seenEntries.has(entry.id)) continue;
        seenEntries.add(entry.id);
        if (entry.kind && entry.kind !== 'task') continue;
        for (const change of entry.changes) {
            const after = change.after as Record<string, unknown>;
            const projectId = typeof after.projectId === 'string' ? after.projectId : undefined;
            const areaId = typeof after.areaId === 'string' ? after.areaId : undefined;
            if (projectId || areaId) trackAiPlacement(change.taskId, { title: change.title, projectId, areaId });
        }
    }
}

/** Test seam. */
export function resetAiRoutingTrackerForTests(): void {
    tracked.clear();
    seenEntries.clear();
    unsubscribe?.();
    unsubscribe = null;
}
