import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { Task } from '@stride/core';
import { useTaskStore } from '@stride/core';
import { BlockedByField } from './BlockedByField';

const NOW = '2026-11-08T10:00:00.000Z';
const task = (id: string, extra: Partial<Task> = {}): Task => ({
    id, title: id, status: 'next', tags: [], contexts: [], createdAt: NOW, updatedAt: NOW, ...extra,
}) as Task;
const t = (key: string) => key;

const updateTask = vi.fn(async () => ({ success: true }));

const seed = (tasks: Task[]) => act(() => {
    useTaskStore.setState({ _allTasks: tasks, tasks, _tasksById: new Map(tasks.map((item) => [item.id, item])), updateTask } as never);
});

describe('BlockedByField', () => {
    beforeEach(() => updateTask.mockClear());
    afterEach(() => seed([]));

    it('adds an open task, same project first, and shows removable chips', async () => {
        const current = task('Current', { projectId: 'p1' });
        seed([current, task('Near', { projectId: 'p1', title: 'Near' }), task('Far', { projectId: 'p2' })]);
        render(<BlockedByField task={current} t={t} />);
        fireEvent.focus(screen.getByTestId('blocked-by-search'));
        const options = screen.getAllByRole('option').map((option) => option.textContent);
        expect(options[0]).toContain('Near');
        fireEvent.click(screen.getByTestId('blocked-by-option-Near'));
        expect(updateTask).toHaveBeenCalledWith('Current', { blockedByTaskIds: ['Near'] });
    });

    it('removes a blocker with its chip button', () => {
        const current = task('Current', { blockedByTaskIds: ['Near', 'Far'] });
        seed([current, task('Near'), task('Far')]);
        render(<BlockedByField task={current} t={t} />);
        fireEvent.click(screen.getByRole('button', { name: /Remove blocker: Near/ }));
        expect(updateTask).toHaveBeenCalledWith('Current', { blockedByTaskIds: ['Far'] });
    });

    it('clears the field when the last chip is removed', () => {
        const current = task('Current', { blockedByTaskIds: ['Near'] });
        seed([current, task('Near')]);
        render(<BlockedByField task={current} t={t} />);
        fireEvent.click(screen.getByRole('button', { name: /Remove blocker: Near/ }));
        expect(updateTask).toHaveBeenCalledWith('Current', { blockedByTaskIds: undefined });
    });

    it('shows a clear reason for a cycle attempt and does not save', () => {
        const current = task('Current');
        seed([current, task('Waits', { blockedByTaskIds: ['Current'] })]);
        render(<BlockedByField task={current} t={t} />);
        fireEvent.focus(screen.getByTestId('blocked-by-search'));
        fireEvent.click(screen.getByTestId('blocked-by-option-Waits'));
        expect(screen.getByTestId('blocked-by-error')).toHaveTextContent('block each other');
        expect(updateTask).not.toHaveBeenCalled();
    });

    it('shows the store error when saving fails', async () => {
        updateTask.mockResolvedValueOnce({ success: false, error: 'nope' } as never);
        const current = task('Current');
        seed([current, task('Other')]);
        render(<BlockedByField task={current} t={t} />);
        fireEvent.focus(screen.getByTestId('blocked-by-search'));
        await act(async () => { fireEvent.click(screen.getByTestId('blocked-by-option-Other')); });
        expect(screen.getByTestId('blocked-by-error')).toHaveTextContent('nope');
    });
});
