import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Task } from '@stride/core';

import { PanelTaskRow } from './PanelTaskRow';

const base = { id: 't1', title: 'Send Pradeep the reel edit', status: 'next', createdAt: '', updatedAt: '' } as unknown as Task;
const renderRow = (task: Task, priorityLabel?: string) => render(
    <ul>
        <PanelTaskRow task={task} tone="default" completing={false} completeLabel="Complete" todayLabel="Today"
            priorityLabel={priorityLabel} onComplete={vi.fn()} onOpen={vi.fn()} onRowKeyDown={vi.fn()} />
    </ul>,
);

describe('PanelTaskRow priority', () => {
    it('names high and urgent priority in words', () => {
        renderRow({ ...base, priority: 'urgent' } as Task, 'Urgent');
        expect(screen.getByTestId('menubar-row-priority')).toHaveTextContent('Urgent');
    });

    it('stays quiet for low and medium priority', () => {
        renderRow({ ...base, priority: 'low' } as Task, 'Low');
        expect(screen.queryByTestId('menubar-row-priority')).toBeNull();
    });
});
