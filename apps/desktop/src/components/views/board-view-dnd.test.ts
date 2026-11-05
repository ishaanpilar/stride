import { describe, expect, it } from 'vitest';
import { resolveBoardDragEnd, resolveBoardEdgeMove } from './board-view-dnd';

const COLUMN_IDS = ['inbox', 'next', 'waiting', 'someday', 'done'] as const;

describe('resolveBoardDragEnd', () => {
    const baseArgs = {
        activeId: 'task-e',
        columnIds: [...COLUMN_IDS],
        activeStatus: 'next' as const,
        overStatus: undefined,
        columnTaskIds: ['task-q', 'task-w', 'task-e', 'task-r'],
        canReorder: true,
    };

    it('moves the task when dropped on a different column', () => {
        const action = resolveBoardDragEnd({ ...baseArgs, overId: 'waiting' });

        expect(action).toEqual({ type: 'move', taskId: 'task-e', status: 'waiting' });
    });

    it('does nothing when dropped on its own column', () => {
        const action = resolveBoardDragEnd({ ...baseArgs, overId: 'next' });

        expect(action).toEqual({ type: 'none' });
    });

    it('moves the task to the bottom when the target column order is unknown', () => {
        const action = resolveBoardDragEnd({
            ...baseArgs,
            overId: 'task-other',
            overStatus: 'someday',
        });

        expect(action).toEqual({ type: 'move', taskId: 'task-e', status: 'someday' });
    });

    it('moves and inserts at the dropped card position in another column', () => {
        const action = resolveBoardDragEnd({
            ...baseArgs,
            overId: 'task-2',
            overStatus: 'someday',
            overColumnTaskIds: ['task-1', 'task-2', 'task-3'],
        });

        expect(action).toEqual({
            type: 'moveAndReorder',
            taskId: 'task-e',
            status: 'someday',
            orderedIds: ['task-1', 'task-e', 'task-2', 'task-3'],
        });
    });

    it('places the task at the top of another column when dropped on its first card', () => {
        const action = resolveBoardDragEnd({
            activeId: 'task-n',
            columnIds: [...COLUMN_IDS],
            activeStatus: 'next',
            overId: 'task-1',
            overStatus: 'waiting',
            columnTaskIds: ['task-l', 'task-m', 'task-n', 'task-o', 'task-p'],
            overColumnTaskIds: ['task-1', 'task-2', 'task-3', 'task-4', 'task-5'],
            canReorder: true,
        });

        expect(action).toEqual({
            type: 'moveAndReorder',
            taskId: 'task-n',
            status: 'waiting',
            orderedIds: ['task-n', 'task-1', 'task-2', 'task-3', 'task-4', 'task-5'],
        });
    });

    it('only moves across columns (no positioning) when a non-default sort is active', () => {
        const action = resolveBoardDragEnd({
            ...baseArgs,
            overId: 'task-2',
            overStatus: 'someday',
            overColumnTaskIds: ['task-1', 'task-2', 'task-3'],
            canReorder: false,
        });

        expect(action).toEqual({ type: 'move', taskId: 'task-e', status: 'someday' });
    });

    it('reorders the column when dropped on a card with the same status', () => {
        const action = resolveBoardDragEnd({
            ...baseArgs,
            overId: 'task-q',
            overStatus: 'next',
        });

        expect(action).toEqual({
            type: 'reorder',
            status: 'next',
            orderedIds: ['task-e', 'task-q', 'task-w', 'task-r'],
        });
    });

    it('reorders downward keeping the issue #711 example order', () => {
        const action = resolveBoardDragEnd({
            ...baseArgs,
            activeId: 'task-q',
            overId: 'task-r',
            overStatus: 'next',
        });

        expect(action).toEqual({
            type: 'reorder',
            status: 'next',
            orderedIds: ['task-w', 'task-e', 'task-r', 'task-q'],
        });
    });

    it('does not reorder when a non-default sort is active', () => {
        const action = resolveBoardDragEnd({
            ...baseArgs,
            overId: 'task-q',
            overStatus: 'next',
            canReorder: false,
        });

        expect(action).toEqual({ type: 'none' });
    });

    it('does nothing when the dragged task is unknown', () => {
        const action = resolveBoardDragEnd({
            ...baseArgs,
            activeStatus: undefined,
            overId: 'waiting',
        });

        expect(action).toEqual({ type: 'none' });
    });

    it('does nothing when dropped on itself', () => {
        const action = resolveBoardDragEnd({
            ...baseArgs,
            overId: 'task-e',
            overStatus: 'next',
        });

        expect(action).toEqual({ type: 'none' });
    });
});

import { resolveBoardKeyboardMove } from './board-view-dnd';

describe('resolveBoardKeyboardMove', () => {
    const base = {
        taskId: 'b',
        columnIds: [...COLUMN_IDS],
        status: 'next' as const,
        columnTaskIds: ['a', 'b', 'c'],
        canReorder: true,
    };

    it('moves across columns with Left/Right and stops at the edges', () => {
        expect(resolveBoardKeyboardMove({ ...base, direction: 'right' })).toEqual({ type: 'move', taskId: 'b', status: 'waiting' });
        expect(resolveBoardKeyboardMove({ ...base, direction: 'left' })).toEqual({ type: 'move', taskId: 'b', status: 'inbox' });
        expect(resolveBoardKeyboardMove({ ...base, status: 'inbox', direction: 'left' })).toEqual({ type: 'none' });
        expect(resolveBoardKeyboardMove({ ...base, status: 'done', direction: 'right' })).toEqual({ type: 'none' });
    });

    it('reorders within the column with Up/Down', () => {
        expect(resolveBoardKeyboardMove({ ...base, direction: 'up' })).toEqual({ type: 'reorder', status: 'next', orderedIds: ['b', 'a', 'c'] });
        expect(resolveBoardKeyboardMove({ ...base, direction: 'down' })).toEqual({ type: 'reorder', status: 'next', orderedIds: ['a', 'c', 'b'] });
        expect(resolveBoardKeyboardMove({ ...base, taskId: 'a', direction: 'up' })).toEqual({ type: 'none' });
        expect(resolveBoardKeyboardMove({ ...base, direction: 'down', canReorder: false })).toEqual({ type: 'none' });
    });
});

describe('resolveBoardEdgeMove', () => {
    it('sends a card to the top or bottom and ignores no-ops', () => {
        expect(resolveBoardEdgeMove('b', 'next', 'top', ['a', 'b', 'c'], true)).toEqual({ type: 'reorder', status: 'next', orderedIds: ['b', 'a', 'c'] });
        expect(resolveBoardEdgeMove('b', 'next', 'bottom', ['a', 'b', 'c'], true)).toEqual({ type: 'reorder', status: 'next', orderedIds: ['a', 'c', 'b'] });
        expect(resolveBoardEdgeMove('a', 'next', 'top', ['a', 'b'], true)).toEqual({ type: 'none' });
        expect(resolveBoardEdgeMove('b', 'next', 'top', ['a', 'b'], false)).toEqual({ type: 'none' });
    });
});
