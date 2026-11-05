import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createTaskDraft, type Task, type TaskDraft, type TaskDraftSetter, type TaskFillResult } from '@stride/core';

import { useTaskFillAi } from './useTaskFillAi';
import { TaskFillAiButton, TaskFillAiProposals } from './TaskFillAiPanel';

const updateTaskFromLatest = vi.hoisted(() => vi.fn(async () => ({ success: true })));
vi.mock('@stride/core', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@stride/core')>()),
    updateTaskFromLatest,
}));

const task: Task = {
    id: 'task-1',
    title: 'Go to the dentist tomorrow',
    status: 'inbox',
    tags: [],
    contexts: [],
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
};

const t = (key: string) => key;

const aiResult: TaskFillResult = {
    source: 'ai',
    proposals: [
        { field: 'destination', kind: 'area', id: 'a-health', label: 'Health', reason: 'mentions dentist' },
        { field: 'contexts', values: ['@errands'], newValues: [], reason: 'Out of the house' },
        { field: 'priority', value: 'high' },
        { field: 'dueDate', value: '2026-11-06', reason: 'Says tomorrow' },
    ],
};

type HarnessProps = {
    enabled?: boolean;
    request: (args: { current: { title: string } }) => Promise<TaskFillResult>;
    onDraft?: (draft: TaskDraft) => void;
    initial?: Partial<TaskDraft>;
};

function Harness({ enabled = true, request, onDraft, initial }: HarnessProps) {
    const [draft, setDraft] = useState<TaskDraft>(() => ({ ...createTaskDraft(task), ...initial }));
    onDraft?.(draft);
    const setField: TaskDraftSetter = (field, value) => setDraft((prev) => ({ ...prev, [field]: value }));
    const fill = useTaskFillAi({
        task,
        draft,
        setField,
        enabled,
        knownContexts: ['@errands'],
        knownTags: [],
        language: 'en',
        request: request as never,
    });
    return (
        <div>
            <TaskFillAiButton fill={fill} t={t} />
            <TaskFillAiProposals fill={fill} t={t} />
            <button type="button" onClick={() => setField('priority', 'low')}>user sets priority</button>
        </div>
    );
}

describe('Fill with AI in the task editor', () => {
    it('is hidden when AI is off', () => {
        const view = render(<Harness enabled={false} request={vi.fn()} />);
        expect(view.queryByRole('button', { name: 'Fill with AI' })).not.toBeInTheDocument();
    });

    it('shows proposals with reasons and applies nothing until a click', async () => {
        let draft: TaskDraft | undefined;
        const request = vi.fn(async (_args: { current: { title: string } }) => aiResult);
        const view = render(<Harness request={request} onDraft={(d) => { draft = d; }} />);

        await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Fill with AI' })); });
        expect(request).toHaveBeenCalledTimes(1);
        expect(request.mock.calls[0]?.[0].current.title).toBe('Go to the dentist tomorrow');

        await waitFor(() => expect(view.getByRole('button', { name: 'Destination: Health' })).toBeInTheDocument());
        expect(view.getByText('mentions dentist')).toBeInTheDocument();
        expect(view.getByText('Says tomorrow')).toBeInTheDocument();
        expect(draft?.areaId).toBe('');
        expect(draft?.priority).toBe('');

        fireEvent.click(view.getByRole('button', { name: 'Destination: Health' }));
        expect(draft?.areaId).toBe('a-health');
        expect(draft?.projectId).toBe('');
        expect(view.queryByRole('button', { name: 'Destination: Health' })).not.toBeInTheDocument();

        fireEvent.click(view.getByRole('button', { name: 'Undo' }));
        expect(draft?.areaId).toBe('');
        expect(view.getByRole('button', { name: 'Destination: Health' })).toBeInTheDocument();
    });

    it('applies all proposals at once and undoes them together', async () => {
        let draft: TaskDraft | undefined;
        const view = render(<Harness request={async () => aiResult} onDraft={(d) => { draft = d; }} />);
        await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Fill with AI' })); });
        await waitFor(() => expect(view.getByRole('button', { name: 'Apply all' })).toBeInTheDocument());

        fireEvent.click(view.getByRole('button', { name: 'Apply all' }));
        expect(draft).toMatchObject({ areaId: 'a-health', contexts: '@errands', priority: 'high', dueDate: '2026-11-06' });

        fireEvent.click(view.getByRole('button', { name: 'Undo' }));
        expect(draft).toMatchObject({ areaId: '', contexts: '', priority: '', dueDate: '' });
    });

    it('drops a proposal once the user fills that field (empty fields only)', async () => {
        const view = render(<Harness request={async () => aiResult} />);
        await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Fill with AI' })); });
        await waitFor(() => expect(view.getByRole('button', { name: 'Priority: high' })).toBeInTheDocument());

        fireEvent.click(view.getByRole('button', { name: 'user sets priority' }));
        expect(view.queryByRole('button', { name: 'Priority: high' })).not.toBeInTheDocument();
    });

    it('labels deterministic fallback suggestions and says when there is nothing to suggest', async () => {
        const fallback = render(<Harness request={async () => ({ source: 'fallback', proposals: [aiResult.proposals[3]] })} />);
        await act(async () => { fireEvent.click(fallback.getByRole('button', { name: 'Fill with AI' })); });
        await waitFor(() => expect(fallback.getByText('AI unavailable. Showing basic suggestions.')).toBeInTheDocument());
        fallback.unmount();

        const empty = render(<Harness request={async () => ({ source: 'ai', proposals: [] })} />);
        await act(async () => { fireEvent.click(empty.getByRole('button', { name: 'Fill with AI' })); });
        await waitFor(() => expect(empty.getByText('No suggestions for the empty fields.')).toBeInTheDocument());
    });

    it('adds grounded checklist steps on click and removes exactly those on undo', async () => {
        updateTaskFromLatest.mockClear();
        const view = render(<Harness request={async () => ({
            source: 'ai',
            proposals: [{ field: 'checklist', values: ['Ask about the crown'], reason: 'From the notes and related tasks' }],
        })} />);
        await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Fill with AI' })); });
        await waitFor(() => expect(view.getByRole('button', { name: 'Checklist: Ask about the crown' })).toBeInTheDocument());

        fireEvent.click(view.getByRole('button', { name: 'Checklist: Ask about the crown' }));
        expect(updateTaskFromLatest).toHaveBeenCalledTimes(1);
        const add = (updateTaskFromLatest.mock.calls[0] as unknown[])[1] as (latest: Task) => Partial<Task>;
        const added = add({ ...task, checklist: [] }).checklist ?? [];
        expect(added.map((item) => item.title)).toEqual(['Ask about the crown']);

        fireEvent.click(view.getByRole('button', { name: 'Undo' }));
        const remove = (updateTaskFromLatest.mock.calls[1] as unknown[])[1] as (latest: Task) => Partial<Task>;
        const keep = { id: 'keep', title: 'Mine', isCompleted: false };
        expect(remove({ ...task, checklist: [keep, ...added] }).checklist).toEqual([keep]);
    });
});
