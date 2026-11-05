import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Task } from '@stride/core';

import { PanelTaskRow, type PanelRowLabels } from './PanelTaskRow';

const base = { id: 't1', title: 'Send Pradeep the reel edit', status: 'next', createdAt: '', updatedAt: '' } as unknown as Task;
const labels: PanelRowLabels = {
    complete: 'Complete', markNotDone: 'Mark not done', today: 'Today', overdue: 'Overdue', focus: 'Focus',
    start: 'Start a focus timer', addToNow: 'Add to Now',
};
const renderRow = (task: Task, extra: Partial<Parameters<typeof PanelTaskRow>[0]> = {}) => render(
    <ul>
        <PanelTaskRow task={task} tone="default" done={false} labels={labels}
            onComplete={vi.fn()} onOpen={vi.fn()} onRowKeyDown={vi.fn()} {...extra} />
    </ul>,
);

describe('PanelTaskRow', () => {
    it('names high and urgent priority in words', () => {
        renderRow({ ...base, priority: 'urgent' } as Task, { priorityLabel: 'Urgent' });
        expect(screen.getByTestId('menubar-row-priority')).toHaveTextContent('Urgent');
    });

    it('stays quiet for low and medium priority', () => {
        renderRow({ ...base, priority: 'low' } as Task, { priorityLabel: 'Low' });
        expect(screen.queryByTestId('menubar-row-priority')).toBeNull();
    });

    it('says overdue in words, shows the focus star and the project', () => {
        renderRow({ ...base, dueDate: '2026-11-04' } as Task, {
            tone: 'overdue', focused: true,
            project: { id: 'p', title: 'Prad', color: '#60a5fa' } as never,
        });
        expect(screen.getByTestId('menubar-row-date')).toHaveTextContent(/^Overdue · /);
        expect(screen.getByTestId('menubar-row-focus')).toHaveTextContent('Focus');
        expect(screen.getByText('Prad')).toBeInTheDocument();
    });

    it('shows the time on a timed task due today', () => {
        renderRow({ ...base, dueDate: '2026-11-05T14:00:00' } as Task, { tone: 'today' });
        expect(screen.getByTestId('menubar-row-date').textContent).toMatch(/^Today \d/);
    });

    it('offers ▶ and ＋ only when given, and not on a done row', () => {
        const onStart = vi.fn();
        const onAddToNow = vi.fn();
        const view = renderRow(base, { onStart, onAddToNow });
        fireEvent.click(screen.getByRole('button', { name: 'Start a focus timer: Send Pradeep the reel edit' }));
        fireEvent.click(screen.getByRole('button', { name: 'Add to Now: Send Pradeep the reel edit' }));
        expect(onStart).toHaveBeenCalledWith(base);
        expect(onAddToNow).toHaveBeenCalledWith(base);
        view.unmount();
        renderRow({ ...base, status: 'done' } as Task, { done: true, onStart, onAddToNow });
        expect(screen.queryByTestId('menubar-row-start')).toBeNull();
        expect(screen.queryByTestId('menubar-row-add-now')).toBeNull();
        expect(screen.getByRole('button', { name: /^Mark not done/ })).toBeInTheDocument();
    });
});
