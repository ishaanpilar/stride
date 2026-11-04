import { describe, it, expect, vi, beforeEach } from 'vitest';
import { clearUndoableAction, registerUndoableAction, takeUndoableAction } from './undo-registry';

describe('undo-registry', () => {
    beforeEach(() => {
        clearUndoableAction();
    });

    it('returns the last registered action once', () => {
        const action = vi.fn();
        registerUndoableAction(action);

        const undo = takeUndoableAction();
        undo?.();

        expect(action).toHaveBeenCalledTimes(1);
        expect(takeUndoableAction()).toBeNull();
    });

    it('keeps only the most recent action', () => {
        const first = vi.fn();
        const second = vi.fn();
        registerUndoableAction(first);
        registerUndoableAction(second);

        takeUndoableAction()?.();

        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
    });

    it('clears the registry when the returned closure runs (toast click)', () => {
        const action = vi.fn();
        const undo = registerUndoableAction(action);

        undo();

        expect(action).toHaveBeenCalledTimes(1);
        expect(takeUndoableAction()).toBeNull();
    });

    it('does not clear a newer action when a stale closure runs', () => {
        const first = vi.fn();
        const second = vi.fn();
        const undoFirst = registerUndoableAction(first);
        registerUndoableAction(second);

        undoFirst();

        expect(takeUndoableAction()).not.toBeNull();
    });
});
