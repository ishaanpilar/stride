import { useCallback, useSyncExternalStore } from 'react';
import { compareProjectsByOrder, sortTasksByBoardOrder, splitOrderedIdsByStatus, tFallback, useTaskStore, type TaskStatus, type TranslateFn } from '@stride/core';
import { reportError } from './report-error';
import { showUndoToast } from './undo-registry';

export const MANUAL_ORDER_KEYS = {
    inbox: 'inbox',
    next: 'next',
    today: 'focus-today',
    upcoming: 'menubar-upcoming',
    focusProjects: 'focus-projects',
} as const;

const storageKey = (viewKey: string) => `stride:view:manual-order:${viewKey}:v1`;
const listeners = new Set<() => void>();
const memoryFlags = new Map<string, boolean>();

export function readManualOrder(viewKey: string): boolean {
    try {
        return window.localStorage.getItem(storageKey(viewKey)) === '1';
    } catch {
        return memoryFlags.get(viewKey) === true;
    }
}

export function writeManualOrder(viewKey: string, value: boolean): void {
    try {
        if (value) window.localStorage.setItem(storageKey(viewKey), '1');
        else window.localStorage.removeItem(storageKey(viewKey));
    } catch {
        memoryFlags.set(viewKey, value);
    }
    listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    const onStorage = (event: StorageEvent) => {
        if (event.key === null || event.key.startsWith('stride:view:manual-order:')) listener();
    };
    window.addEventListener('storage', onStorage);
    return () => {
        listeners.delete(listener);
        window.removeEventListener('storage', onStorage);
    };
}

export function useManualOrderMode(viewKey: string): [boolean, (value: boolean) => void] {
    const manual = useSyncExternalStore(subscribe, () => readManualOrder(viewKey), () => false);
    const setManual = useCallback((value: boolean) => writeManualOrder(viewKey, value), [viewKey]);
    return [manual, setManual];
}

function statusLookup(): (id: string) => TaskStatus | undefined {
    const state = useTaskStore.getState();
    const byId = new Map(state._allTasks.map((task) => [task.id, task.status] as const));
    return (id) => state._tasksById?.get(id)?.status ?? byId.get(id);
}

export async function commitBoardOrder(nextIds: readonly string[], movedId?: string): Promise<void> {
    const state = useTaskStore.getState();
    const groups = splitOrderedIdsByStatus<TaskStatus>(nextIds, statusLookup());
    for (const group of groups) {
        await state.reorderBoardTasks(group.status, group.ids, movedId && group.ids.includes(movedId) ? movedId : undefined);
    }
}

export type BoardOrderSnapshot = Array<{ status: TaskStatus; ids: string[] }>;

export function snapshotBoardOrder(statuses: readonly TaskStatus[]): BoardOrderSnapshot {
    const all = useTaskStore.getState()._allTasks;
    return [...new Set(statuses)].map((status) => ({
        status,
        ids: sortTasksByBoardOrder(all.filter((task) => task.status === status && !task.deletedAt)).map((task) => task.id),
    }));
}

export async function restoreBoardOrder(snapshot: BoardOrderSnapshot): Promise<void> {
    const state = useTaskStore.getState();
    for (const { status, ids } of snapshot) {
        if (ids.length > 0) await state.reorderBoardTasks(status, ids);
    }
}

export type ProjectOrderSnapshot = { areaId: string | undefined; ids: string[] };

/** One area's project order, for Undo (a project's order is per area: see reorderProjects). */
export function snapshotProjectOrder(areaId: string | undefined): ProjectOrderSnapshot {
    const ids = useTaskStore.getState()._allProjects
        .filter((project) => (project.areaId ?? undefined) === areaId && !project.deletedAt)
        .sort(compareProjectsByOrder)
        .map((project) => project.id);
    return { areaId, ids };
}

export async function restoreProjectOrder({ areaId, ids }: ProjectOrderSnapshot): Promise<void> {
    if (ids.length > 0) await useTaskStore.getState().reorderProjects(ids, areaId);
}

export function statusesOf(ids: readonly string[]): TaskStatus[] {
    const statusOf = statusLookup();
    return [...new Set(ids.map(statusOf).filter((status): status is TaskStatus => Boolean(status)))];
}

export function switchedToManualOrderMessage(t: TranslateFn): string {
    return tFallback(t, 'list.reorder.switchedToManual', 'Switched to manual order');
}

export function switchToManualOrderWithUndo({
    viewKey,
    snapshot,
    t,
    restoreSort,
    previousManual = false,
}: {
    viewKey: string;
    snapshot: BoardOrderSnapshot;
    t: TranslateFn;
    restoreSort?: () => void;
    previousManual?: boolean;
}): void {
    writeManualOrder(viewKey, true);
    showUndoToast(switchedToManualOrderMessage(t), () => {
        writeManualOrder(viewKey, previousManual);
        restoreSort?.();
        void restoreBoardOrder(snapshot).catch((error) => reportError('Failed to restore the previous order', error));
    }, t);
}
