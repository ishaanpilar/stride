import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTaskStore, type Task } from '@stride/core';

import { LanguageProvider } from '../../contexts/language-context';
import { guardRepeatTick, resetRepeatTickGuardForTests } from '../../lib/repeating-completion';
import { RepeatTickConfirm } from './RepeatTickConfirm';

const makeTask = (id: string, overrides: Partial<Task> = {}): Task => ({
    id,
    title: `Task ${id}`,
    status: 'next',
    tags: [],
    contexts: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
} as Task);

const seed = (tasks: Task[]) => useTaskStore.setState({
    tasks, _allTasks: tasks, _tasksById: new Map(tasks.map((task) => [task.id, task])),
} as never);

describe('RepeatTickConfirm for a task that is still waiting', () => {
    afterEach(() => { act(() => resetRepeatTickGuardForTests()); });

    const ask = (proceed: () => void) => {
        seed([makeTask('blocker', { title: 'Visit vendors' }), makeTask('waiting', { blockedByTaskIds: ['blocker'] })]);
        render(<LanguageProvider><RepeatTickConfirm taskId="waiting" /></LanguageProvider>);
        act(() => guardRepeatTick('waiting', proceed));
    };

    it('names the blocker and completes on Done anyway', () => {
        const proceed = vi.fn();
        ask(proceed);
        expect(screen.getByTestId('repeat-tick-confirm')).toHaveTextContent('This is waiting for Visit vendors.');
        expect(proceed).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Done anyway' }));
        expect(proceed).toHaveBeenCalledTimes(1);
        expect(screen.queryByTestId('repeat-tick-confirm')).toBeNull();
    });

    it('does nothing on Cancel', () => {
        const proceed = vi.fn();
        ask(proceed);
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(proceed).not.toHaveBeenCalled();
        expect(screen.queryByTestId('repeat-tick-confirm')).toBeNull();
    });
});
