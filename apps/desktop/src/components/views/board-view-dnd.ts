import type { TaskStatus } from '@stride/core';

export type BoardDragEndAction =
    | { type: 'none' }
    | { type: 'move'; taskId: string; status: TaskStatus }
    | { type: 'reorder'; status: TaskStatus; orderedIds: string[] }
    | { type: 'moveAndReorder'; taskId: string; status: TaskStatus; orderedIds: string[] };

export type BoardDragEndArgs = {
    activeId: string;
    overId: string;
    columnIds: TaskStatus[];

    activeStatus: TaskStatus | undefined;

    overStatus: TaskStatus | undefined;

    columnTaskIds: string[];

    overColumnTaskIds?: string[];

    canReorder: boolean;
};

export function resolveBoardDragEnd({
    activeId,
    overId,
    columnIds,
    activeStatus,
    overStatus,
    columnTaskIds,
    overColumnTaskIds,
    canReorder,
}: BoardDragEndArgs): BoardDragEndAction {
    if (!activeStatus || activeId === overId) return { type: 'none' };

    if (columnIds.includes(overId as TaskStatus)) {
        const status = overId as TaskStatus;
        if (status === activeStatus) return { type: 'none' };
        return { type: 'move', taskId: activeId, status };
    }

    if (!overStatus) return { type: 'none' };
    if (overStatus !== activeStatus) {


        if (canReorder && overColumnTaskIds) {
            const toIndex = overColumnTaskIds.indexOf(overId);
            if (toIndex >= 0) {
                const orderedIds = overColumnTaskIds.filter((id) => id !== activeId);
                orderedIds.splice(toIndex, 0, activeId);
                return { type: 'moveAndReorder', taskId: activeId, status: overStatus, orderedIds };
            }
        }
        return { type: 'move', taskId: activeId, status: overStatus };
    }

    if (!canReorder) return { type: 'none' };
    const fromIndex = columnTaskIds.indexOf(activeId);
    const toIndex = columnTaskIds.indexOf(overId);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return { type: 'none' };

    const orderedIds = [...columnTaskIds];
    orderedIds.splice(fromIndex, 1);
    orderedIds.splice(toIndex, 0, activeId);
    return { type: 'reorder', status: activeStatus, orderedIds };
}

export type BoardKeyboardDirection = 'left' | 'right' | 'up' | 'down';

/** Alt+Arrow card move: Left/Right change column, Up/Down reorder within the column. */
export function resolveBoardKeyboardMove({
    taskId,
    direction,
    columnIds,
    status,
    columnTaskIds,
    canReorder,
}: {
    taskId: string;
    direction: BoardKeyboardDirection;
    columnIds: TaskStatus[];
    status: TaskStatus;
    columnTaskIds: string[];
    canReorder: boolean;
}): BoardDragEndAction {
    if (direction === 'left' || direction === 'right') {
        const index = columnIds.indexOf(status);
        const next = columnIds[index + (direction === 'left' ? -1 : 1)];
        if (index < 0 || !next) return { type: 'none' };
        return { type: 'move', taskId, status: next };
    }
    if (!canReorder) return { type: 'none' };
    const from = columnTaskIds.indexOf(taskId);
    const to = from + (direction === 'up' ? -1 : 1);
    if (from < 0 || to < 0 || to >= columnTaskIds.length) return { type: 'none' };
    const orderedIds = [...columnTaskIds];
    orderedIds.splice(from, 1);
    orderedIds.splice(to, 0, taskId);
    return { type: 'reorder', status, orderedIds };
}

/** Send a card to the top or bottom of its column (menu action, Alt+Shift+Up/Down). */
export function resolveBoardEdgeMove(
    taskId: string,
    status: TaskStatus,
    edge: 'top' | 'bottom',
    columnTaskIds: string[],
    canReorder: boolean,
): BoardDragEndAction {
    if (!canReorder) return { type: 'none' };
    const from = columnTaskIds.indexOf(taskId);
    if (from < 0) return { type: 'none' };
    if (edge === 'top' ? from === 0 : from === columnTaskIds.length - 1) return { type: 'none' };
    const rest = columnTaskIds.filter((id) => id !== taskId);
    const orderedIds = edge === 'top' ? [taskId, ...rest] : [...rest, taskId];
    return { type: 'reorder', status, orderedIds };
}
