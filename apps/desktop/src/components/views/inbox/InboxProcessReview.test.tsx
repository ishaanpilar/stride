import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import type { InboxProcessProposal } from '@stride/core';

vi.mock('../../../contexts/language-context', () => ({
    useLanguage: () => ({ t: (key: string) => key, language: 'en' }),
    getCurrentUiLanguage: () => 'en',
}));

import { InboxProcessReview } from './InboxProcessReview';
import { useInboxAiProcess, type UseInboxAiProcessOptions } from './useInboxAiProcess';
import { useCaptureText } from '../../capture/useCaptureText';
import { getInboxSuggestions, resetInboxSuggestionsForTests } from '../../../lib/inbox-process-service';
import { takeUndoableAction } from '../../../lib/undo-registry';
import { useUiStore } from '../../../store/ui-store';

const proposal: InboxProcessProposal = {
    source: 'ai',
    summary: 'Sorted 4 items.',
    skippedTaskIds: [],
    items: [
        { taskId: 'a', originalTitle: 'dentist', title: 'Call the dentist', kind: 'next', areaName: 'Home', reason: 'personal health', needsYou: false },
        { taskId: 'b', originalTitle: 'offsite', title: 'Pick a date', kind: 'project', newProjectTitle: 'Team offsite', needsYou: false },
        { taskId: 'c', originalTitle: 'thing for mars', title: 'thing for mars', kind: 'next', newAreaName: 'Mars', needsYou: true, needsYouReason: 'unknown-area' },
        { taskId: 'd', originalTitle: 'dentist again', title: 'dentist again', kind: 'delete', duplicateOf: 'a', needsYou: false },
    ],
};

function Harness(props: Partial<UseInboxAiProcessOptions> & { onManualProcess?: () => void }) {
    const t = useCaptureText();
    const controller = useInboxAiProcess({ t, onManualProcess: props.onManualProcess ?? vi.fn(), ...props });
    return (
        <div>
            <button type="button" onClick={() => { void controller.start(); }}>start</button>
            <span data-testid="phase">{controller.phase}</span>
            <span data-testid="notice">{controller.notice ?? ''}</span>
            {controller.phase === 'review' || controller.phase === 'applying'
                ? <InboxProcessReview t={t} controller={controller} projectNames={['Website']} areaNames={['Home', 'Work']} titleFor={(id) => (id === 'a' ? 'dentist' : undefined)} />
                : null}
        </div>
    );
}

describe('Process Inbox with AI', () => {
    beforeEach(() => {
        localStorage.clear();
        resetInboxSuggestionsForTests();
        useUiStore.setState({ toasts: [] });
    });

    it('shows a grouped review with reasons and new-project/area flags; needs-you rows start skipped', async () => {
        const generate = vi.fn().mockResolvedValue({ status: 'ok', proposal });
        const { getByText, getByRole, findByText, container } = render(<Harness generate={generate} apply={vi.fn()} />);
        fireEvent.click(getByText('start'));
        await findByText('Sorted 4 items.');
        expect(getByRole('group', { name: 'Next actions' })).toBeInTheDocument();
        expect(getByRole('group', { name: 'Projects' })).toBeInTheDocument();
        expect(getByRole('group', { name: 'Delete or duplicate' })).toBeInTheDocument();
        expect(getByRole('group', { name: 'Needs you' })).toBeInTheDocument();
        expect(getByText('Why: personal health')).toBeInTheDocument();
        expect(getByText('New project: Team offsite')).toBeInTheDocument();
        expect(getByText('New area: Mars')).toBeInTheDocument();
        expect(getByText('Duplicate of “dentist”')).toBeInTheDocument();
        expect(container.querySelector('[data-inbox-review-row="c"]')).toHaveAttribute('data-decision', 'skip');
        expect(getByRole('button', { name: 'Apply 3' })).toBeInTheDocument();
    });

    it('applies accepted rows as one batch, remembers skipped ones, and one Undo reverts it', async () => {
        const generate = vi.fn().mockResolvedValue({ status: 'ok', proposal });
        const apply = vi.fn().mockResolvedValue({
            updatedTaskIds: ['a'], deletedTaskIds: ['d'], createdProjectIds: [], createdAreaIds: [], failed: [], undoOps: [{ kind: 'restoreTask', taskId: 'd' }], changes: [], changeId: 'change-1',
        });
        const undo = vi.fn().mockResolvedValue(true);
        const { getByText, getByRole, getByLabelText, findByText, getByTestId } = render(<Harness generate={generate} apply={apply} undo={undo} onCorrection={vi.fn()} />);
        fireEvent.click(getByText('start'));
        await findByText('Sorted 4 items.');
        // Skip the project row.
        fireEvent.click(getByLabelText('Skip “Pick a date”'));
        expect(getByRole('button', { name: 'Apply 2' })).toBeInTheDocument();
        await act(async () => { fireEvent.click(getByRole('button', { name: 'Apply 2' })); });
        await waitFor(() => expect(getByTestId('phase')).toHaveTextContent('idle'));
        expect(apply).toHaveBeenCalledTimes(1);
        expect(apply.mock.calls[0][0].map((s: { taskId: string }) => s.taskId)).toEqual(['a', 'd']);
        expect(Object.keys(getInboxSuggestions()).sort()).toEqual(['b', 'c']);
        expect(getInboxSuggestions().c.needsYou).toBe(true);

        const toast = useUiStore.getState().toasts.slice(-1)[0]!;
        expect(toast.message).toBe('Processed 2 items');
        const action = takeUndoableAction();
        expect(action).toBeTypeOf('function');
        await act(async () => { action!(); });
        expect(undo).toHaveBeenCalledWith('change-1');
        expect(undo).toHaveBeenCalledTimes(1);
    });

    it('Accept all keeps needs-you rows skipped; editing a needs-you row accepts it', async () => {
        const generate = vi.fn().mockResolvedValue({ status: 'ok', proposal });
        const { getByText, getByRole, getAllByRole, findByText, container } = render(<Harness generate={generate} apply={vi.fn()} />);
        fireEvent.click(getByText('start'));
        await findByText('Sorted 4 items.');
        fireEvent.click(getByLabelTextSafe(container, 'b'));
        fireEvent.click(getByRole('button', { name: 'Accept all' }));
        expect(container.querySelector('[data-inbox-review-row="b"]')).toHaveAttribute('data-decision', 'accept');
        expect(container.querySelector('[data-inbox-review-row="c"]')).toHaveAttribute('data-decision', 'skip');
        const editButtons = getAllByRole('button', { name: 'Edit' });
        fireEvent.click(editButtons[editButtons.length - 1]);
        fireEvent.change(getByRole('combobox', { name: 'Which area?' }), { target: { value: 'Work' } });
        fireEvent.click(getByRole('button', { name: 'Save and accept' }));
        const row = container.querySelector('[data-inbox-review-row="c"]')!;
        expect(row).toHaveAttribute('data-decision', 'accept');
        expect(row).toHaveTextContent('Work');
    });

    it('falls back to the guided one-by-one flow when AI is off', async () => {
        const onManualProcess = vi.fn();
        const generate = vi.fn().mockResolvedValue({ status: 'unavailable', reason: 'disabled' });
        const { getByText, getByTestId } = render(<Harness generate={generate} onManualProcess={onManualProcess} />);
        await act(async () => { fireEvent.click(getByText('start')); });
        expect(onManualProcess).toHaveBeenCalledTimes(1);
        expect(getByTestId('phase')).toHaveTextContent('idle');
    });

    it('keeps the Inbox untouched and offers the manual flow when the AI fails', async () => {
        const onManualProcess = vi.fn();
        const generate = vi.fn().mockResolvedValue({ status: 'unavailable', reason: 'failed' });
        const { getByText, getByTestId } = render(<Harness generate={generate} onManualProcess={onManualProcess} />);
        await act(async () => { fireEvent.click(getByText('start')); });
        expect(getByTestId('notice')).toHaveTextContent('failed');
        expect(onManualProcess).not.toHaveBeenCalled();
    });
});

function getByLabelTextSafe(container: HTMLElement, taskId: string): HTMLElement {
    return container.querySelector(`[data-inbox-review-row="${taskId}"] input[type="checkbox"]`) as HTMLElement;
}
