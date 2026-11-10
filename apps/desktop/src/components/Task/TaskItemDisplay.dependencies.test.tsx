import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useTaskStore, type Task } from '@stride/core';
import type { ComponentProps } from 'react';

import { LanguageProvider } from '../../contexts/language-context';
import { TaskItemDisplay } from './TaskItemDisplay';

const NOW = '2026-11-08T10:00:00.000Z';
const task = (id: string, extra: Partial<Task> = {}): Task => ({
    id, title: id, status: 'next', tags: [], contexts: [], createdAt: NOW, updatedAt: NOW, ...extra,
}) as Task;

const initialState = useTaskStore.getState();

const seed = (tasks: Task[]) => act(() => {
    useTaskStore.setState({ _allTasks: tasks, tasks, _tasksById: new Map(tasks.map((item) => [item.id, item])) });
});

const row = (rowTask: Task) => {
    const props = {
        task: rowTask, language: 'en', selectionMode: false, isViewOpen: false,
        actions: { onToggleView: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), onDuplicate: vi.fn(), onStatusChange: vi.fn(), openAttachment: vi.fn() },
        visibleAttachments: [], recurrenceRule: '', recurrenceStrategy: 'strict',
        prioritiesEnabled: false, timeEstimatesEnabled: false, isStagnant: false,
        showCompactMeta: true, showQuickDone: false, readOnly: false, showTaskAge: false, t: (key: string) => key,
    } as unknown as ComponentProps<typeof TaskItemDisplay>;
    return <LanguageProvider><TaskItemDisplay {...props} /></LanguageProvider>;
};

describe('TaskItemDisplay dependency metadata', () => {
    afterEach(() => { act(() => useTaskStore.setState(initialState, true)); });

    it('shows a lock and what the task waits for while a blocker is open', () => {
        const blocked = task('Second', { blockedByTaskIds: ['First'] });
        seed([task('First'), blocked]);
        render(row(blocked));
        expect(screen.getByLabelText('Waits for: First')).toBeInTheDocument();
    });

    it('stays quiet once the blocker is done', () => {
        const blocked = task('Second', { blockedByTaskIds: ['First'] });
        seed([task('First', { status: 'done' }), blocked]);
        render(row(blocked));
        expect(screen.queryByLabelText('Waits for: First')).toBeNull();
    });

    it('summarises several blockers', () => {
        const blocked = task('Second', { blockedByTaskIds: ['First', 'Third'] });
        seed([task('First'), task('Third'), blocked]);
        render(row(blocked));
        expect(screen.getByLabelText('Waits for: First +1')).toBeInTheDocument();
    });
});
