import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { useTaskStore, type Project, type ProjectOrderProposal, type Task, type TaskGroupingProposal } from '@stride/core';

import { LooseGroupingSheet } from './LooseGroupingSheet';
import { ProjectOrderSheet } from './ProjectOrderSheet';
import { LooseGroupingBanner } from './LooseGroupingBanner';
import { useUiStore } from '../../store/ui-store';

const applyProjectOrderSelection = vi.hoisted(() => vi.fn());
const applyLooseGrouping = vi.hoisted(() => vi.fn());
const undoAiOrganise = vi.hoisted(() => vi.fn());
vi.mock('../../lib/ai-organise-service', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../lib/ai-organise-service')>()),
    applyProjectOrderSelection,
    applyLooseGrouping,
    undoAiOrganise,
}));
vi.mock('../../lib/report-error', () => ({ reportError: vi.fn() }));

const stamp = '2026-11-08T09:00:00.000Z';
const task = (id: string, title: string): Task => ({ id, title, status: 'next', tags: [], contexts: [], createdAt: stamp, updatedAt: stamp });
const project: Project = { id: 'p', title: 'Build the aircraft', status: 'active', color: '#000', order: 0, tagIds: [], createdAt: stamp, updatedAt: stamp, isSequential: false } as Project;
const t = (key: string) => key;
const proposal: ProjectOrderProposal = {
    projectId: 'p', order: ['d', 'o', 'p2'], recommendNextActionOnly: true, independent: false, orderChanged: true, summary: 'Design first.', source: 'ai',
    dependencies: [{ taskId: 'o', blockerId: 'd', reason: 'Order only a final design' }],
};
const ok = (value: unknown) => vi.fn().mockResolvedValue({ status: 'ok', proposal: value });

beforeEach(() => {
    window.localStorage.clear();
    applyProjectOrderSelection.mockReset().mockResolvedValue({ changeId: 'c1', failed: [] });
    applyLooseGrouping.mockReset().mockResolvedValue({ changeId: 'c2', failed: [] });
    undoAiOrganise.mockReset().mockResolvedValue(true);
    useUiStore.setState({ toasts: [] } as never);
    const tasks = [task('d', 'Finalise the PCB design'), task('o', 'Order the PCB'), task('p2', 'Print the fuselage'), task('h', 'Haircut before Goa'), task('g', 'Pack for Goa'), task('w', 'Washing machine')];
    useTaskStore.setState({ tasks, _allTasks: tasks, settings: { deviceId: 'test' } } as never);
});

const undoAction = () => useUiStore.getState().toasts[0]?.action;

describe('ProjectOrderSheet', () => {
    const render$ = (generate = ok(proposal), onClose = vi.fn()) => ({ onClose, ...render(<ProjectOrderSheet project={project} language="en" t={t} onClose={onClose} generate={generate} />) });

    it('shows a numbered list with the dependency and reason, and changes nothing without Apply', async () => {
        const view = render$();
        await waitFor(() => expect(view.getByTestId('project-order-list')).toBeInTheDocument());
        const rows = view.getByTestId('project-order-list').querySelectorAll('li');
        expect(rows[0].textContent).toContain('Finalise the PCB design');
        expect(rows[1].textContent).toContain('after: Finalise the PCB design · Order only a final design');
        expect(applyProjectOrderSelection).not.toHaveBeenCalled();
        fireEvent.click(view.getByRole('button', { name: 'Cancel' }));
        expect(view.onClose).toHaveBeenCalled();
        expect(applyProjectOrderSelection).not.toHaveBeenCalled();
    });

    it('applies only the toggled parts as one batch, then offers one Undo', async () => {
        const view = render$();
        await waitFor(() => expect(view.getByTestId('project-order-list')).toBeInTheDocument());
        fireEvent.click(view.getByTestId('project-order-dependency'));
        fireEvent.click(view.getByTestId('project-order-next-action-only'));
        await act(async () => { fireEvent.click(view.getByTestId('project-order-apply')); });

        expect(applyProjectOrderSelection).toHaveBeenCalledTimes(1);
        expect(applyProjectOrderSelection.mock.calls[0][1]).toEqual({ applyOrder: true, dependencies: [], applyNextActionOnly: false });
        await waitFor(() => expect(view.onClose).toHaveBeenCalled());
        act(() => undoAction()?.onClick());
        expect(undoAiOrganise).toHaveBeenCalledWith('c1');
    });

    it('says the tasks can be done in any order, with no blocks and no Next action only row', async () => {
        const generate = ok({ ...proposal, dependencies: [], independent: true, recommendNextActionOnly: false, summary: 'whatever' });
        const view = render$(generate);
        await waitFor(() => expect(view.getByTestId('project-order-summary').textContent).toBe('These can be done in any order.'));
        expect(view.queryAllByTestId('project-order-dependency')).toHaveLength(0);
        expect(view.queryByTestId('project-order-next-action-only')).toBeNull();
    });

    it('shows a calm message when AI fails, and no Apply', async () => {
        const view = render$(vi.fn().mockResolvedValue({ status: 'unavailable', reason: 'failed' }));
        await waitFor(() => expect(view.getByTestId('project-order-failure').textContent).toContain('Nothing was changed'));
        expect(view.queryByTestId('project-order-apply')).toBeNull();
        expect(applyProjectOrderSelection).not.toHaveBeenCalled();
    });
});

describe('LooseGroupingSheet', () => {
    const grouping: TaskGroupingProposal = {
        source: 'ai', summary: 'One trip to prepare.', stayLooseTaskIds: ['w'],
        groups: [
            { key: 'g1', title: 'Goa trip', existing: false, areaName: 'Personal', reason: 'Both for the Goa trip', taskIds: ['h', 'g'] },
            { key: 'g2', title: 'Second', existing: false, taskIds: ['d', 'o'] },
        ],
    };
    const render$ = (generate = ok(grouping)) => {
        const onClose = vi.fn();
        return { onClose, ...render(<LooseGroupingSheet tasks={[]} language="en" t={t} onClose={onClose} generate={generate} />) };
    };

    it('lets you rename and skip groups and applies them as one batch with Undo', async () => {
        const view = render$();
        await waitFor(() => expect(view.getAllByTestId('loose-grouping-group')).toHaveLength(2));
        expect(view.getByText('Staying loose: Washing machine')).toBeInTheDocument();
        fireEvent.change(view.getAllByRole('textbox', { name: 'Project name' })[0], { target: { value: 'Goa holiday' } });
        fireEvent.click(view.getByRole('checkbox', { name: 'Accept “Second”' }));
        await act(async () => { fireEvent.click(view.getByTestId('loose-grouping-apply')); });

        expect(applyLooseGrouping).toHaveBeenCalledTimes(1);
        const [applied] = applyLooseGrouping.mock.calls[0];
        expect(applied).toHaveLength(1);
        expect(applied[0]).toMatchObject({ title: 'Goa holiday', taskIds: ['h', 'g'] });
        expect(applied[0]).not.toHaveProperty('accepted');
        act(() => undoAction()?.onClick());
        expect(undoAiOrganise).toHaveBeenCalledWith('c2');
    });

    it('says so when nothing belongs together', async () => {
        const view = render$(ok({ ...grouping, groups: [] }));
        await waitFor(() => expect(view.getByText('Nothing here belongs together yet. These can stay as they are.')).toBeInTheDocument());
        expect(view.queryByTestId('loose-grouping-apply')).toBeNull();
    });
});

describe('LooseGroupingBanner', () => {
    it('stays away below four loose tasks', () => {
        const view = render(<LooseGroupingBanner looseCount={3} t={t} onGroup={vi.fn()} />);
        expect(view.queryByTestId('loose-grouping-banner')).toBeNull();
    });

    it('groups on click, and stays dismissed until three more loose tasks arrive', () => {
        const onGroup = vi.fn();
        const view = render(<LooseGroupingBanner looseCount={6} t={t} onGroup={onGroup} />);
        fireEvent.click(view.getByRole('button', { name: 'Group these' }));
        expect(onGroup).toHaveBeenCalledTimes(1);
        fireEvent.click(view.getByRole('button', { name: 'Dismiss' }));
        expect(view.queryByTestId('loose-grouping-banner')).toBeNull();

        view.rerender(<LooseGroupingBanner looseCount={8} t={t} onGroup={onGroup} />);
        expect(view.queryByTestId('loose-grouping-banner')).toBeNull();
        view.rerender(<LooseGroupingBanner looseCount={9} t={t} onGroup={onGroup} />);
        expect(view.getByTestId('loose-grouping-banner')).toBeInTheDocument();
    });
});
