import { reorderIdsForDrop, type DropPlacement } from '@stride/core';

/**
 * Pure geometry for the menu bar panel's pointer-driven drag-to-reorder. Kept free of the DOM so the
 * landing-spot and auto-scroll maths can be unit tested.
 */

export type RowRect = { id: string; top: number; bottom: number };
export type DropTarget = { targetId: string; placement: DropPlacement };

/** Pixels from the list's top/bottom edge in which dragging scrolls the list. */
export const AUTO_SCROLL_EDGE_PX = 44;
export const AUTO_SCROLL_MAX_STEP = 18;
/** Pointer travel before a press becomes a drag (so plain clicks and taps still open or tick the row). */
export const DRAG_START_THRESHOLD_PX = 5;

/**
 * Where the dragged row would land for a pointer at `pointerY`: before the first row whose midpoint is
 * below the pointer, otherwise after the last one. The dragged row itself is ignored. Null when there is
 * no other row to land next to.
 */
export function computeDropTarget(rows: readonly RowRect[], draggedId: string, pointerY: number): DropTarget | null {
    const others = rows.filter((row) => row.id !== draggedId);
    if (others.length === 0) return null;
    for (const row of others) {
        if (pointerY < row.top + (row.bottom - row.top) / 2) return { targetId: row.id, placement: 'before' };
    }
    return { targetId: others[others.length - 1].id, placement: 'after' };
}

/** The sibling order after dropping `draggedId` at `target`. Unchanged copy when the drop is a no-op. */
export function resolveDropOrder(ids: readonly string[], draggedId: string, target: DropTarget | null): string[] {
    if (!target) return [...ids];
    return reorderIdsForDrop(ids, draggedId, target.targetId, target.placement);
}

export function idsAreEqual(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((id, index) => id === b[index]);
}

/** Signed scroll step for a pointer near the top (negative) or bottom (positive) edge of the list; 0 elsewhere. */
export function autoScrollDelta(
    pointerY: number,
    bounds: { top: number; bottom: number },
    edge: number = AUTO_SCROLL_EDGE_PX,
    maxStep: number = AUTO_SCROLL_MAX_STEP,
): number {
    const fromTop = pointerY - bounds.top;
    const fromBottom = bounds.bottom - pointerY;
    if (fromTop < edge) return -Math.ceil(maxStep * (1 - Math.max(0, fromTop) / edge));
    if (fromBottom < edge) return Math.ceil(maxStep * (1 - Math.max(0, fromBottom) / edge));
    return 0;
}

export function exceedsDragThreshold(dx: number, dy: number, threshold: number = DRAG_START_THRESHOLD_PX): boolean {
    return Math.hypot(dx, dy) >= threshold;
}
