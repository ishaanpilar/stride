import { describe, expect, it } from 'vitest';
import { autoScrollDelta, computeDropTarget, exceedsDragThreshold, resolveDropOrder, type RowRect } from './panel-reorder';

const rows: RowRect[] = [
    { id: 'a', top: 0, bottom: 40 },
    { id: 'b', top: 44, bottom: 84 },
    { id: 'c', top: 88, bottom: 128 },
];

describe('computeDropTarget', () => {
    it('lands before the first row whose midpoint is below the pointer', () => {
        expect(computeDropTarget(rows, 'c', 10)).toEqual({ targetId: 'a', placement: 'before' });
        expect(computeDropTarget(rows, 'c', 50)).toEqual({ targetId: 'b', placement: 'before' });
    });

    it('lands after the last other row when the pointer is below everything', () => {
        expect(computeDropTarget(rows, 'a', 500)).toEqual({ targetId: 'c', placement: 'after' });
    });

    it('ignores the dragged row itself and returns null when it is alone', () => {
        expect(computeDropTarget(rows, 'b', 60)).toEqual({ targetId: 'c', placement: 'before' });
        expect(computeDropTarget([rows[0]], 'a', 10)).toBeNull();
    });
});

describe('resolveDropOrder', () => {
    const ids = ['a', 'b', 'c'];
    it('moves the dragged id to the drop spot', () => {
        expect(resolveDropOrder(ids, 'c', { targetId: 'a', placement: 'before' })).toEqual(['c', 'a', 'b']);
        expect(resolveDropOrder(ids, 'a', { targetId: 'c', placement: 'after' })).toEqual(['b', 'c', 'a']);
    });
    it('is a no-op for dropping on its own neighbour spot or with no target', () => {
        expect(resolveDropOrder(ids, 'b', { targetId: 'c', placement: 'before' })).toEqual(ids);
        expect(resolveDropOrder(ids, 'b', null)).toEqual(ids);
    });
});

describe('autoScrollDelta', () => {
    const bounds = { top: 100, bottom: 400 };
    it('scrolls up near the top edge and down near the bottom edge, faster closer to the edge', () => {
        expect(autoScrollDelta(105, bounds)).toBeLessThan(0);
        expect(autoScrollDelta(395, bounds)).toBeGreaterThan(0);
        expect(Math.abs(autoScrollDelta(101, bounds))).toBeGreaterThan(Math.abs(autoScrollDelta(130, bounds)));
    });
    it('does not scroll in the middle', () => {
        expect(autoScrollDelta(250, bounds)).toBe(0);
    });
});

describe('exceedsDragThreshold', () => {
    it('needs a few pixels of travel before a press becomes a drag', () => {
        expect(exceedsDragThreshold(1, 2)).toBe(false);
        expect(exceedsDragThreshold(0, 8)).toBe(true);
    });
});
