import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ChangeEntry, PendingConfirmation } from '@stride/core';
import { ChangesCard, ConfirmCard, DeclineCard, SuggestionChips } from './AssistantParts';

const entry = (id: string, label: string, over: Partial<ChangeEntry> = {}): ChangeEntry => ({
    id, messageId: 't1', toolName: 'update_task', label, at: '', undone: false, undoOps: [], changes: [], ...over,
});

describe('ChangesCard', () => {
    const long = "Updated 'Call Ria to discuss whether the quarterly planning offsite should move' · due Fri";

    it('shows the full label and undoes a single row', () => {
        const onUndo = vi.fn();
        render(<ChangesCard entries={[entry('a', long)]} onUndo={onUndo} />);
        expect(screen.getByText(long)).toBeTruthy();
        expect(screen.queryByText('Undo all')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: `Undo: ${long}` }));
        expect(onUndo).toHaveBeenCalledWith('a');
    });

    it('shows the routing reason subtly under the label', () => {
        render(<ChangesCard entries={[entry('a', "Added 'Send quotation' · Mauvi Labs", { reason: 'mentions Akash → Mauvi Labs' })]} onUndo={vi.fn()} />);
        expect(screen.getByTestId('assistant-change-reason').textContent).toBe('Why: mentions Akash → Mauvi Labs');
    });

    it('offers Undo all when more than one change is undoable', () => {
        const onUndoAll = vi.fn();
        render(<ChangesCard entries={[entry('a', 'Updated A'), entry('b', 'Deleted B', { toolName: 'delete_task' })]} onUndo={vi.fn()} onUndoAll={onUndoAll} />);
        fireEvent.click(screen.getByText('Undo all'));
        expect(onUndoAll).toHaveBeenCalled();
    });

    it('marks undone rows and hides their Undo button', () => {
        render(<ChangesCard entries={[entry('a', 'Updated A', { undone: true }), entry('b', 'Updated B')]} onUndo={vi.fn()} onUndoAll={vi.fn()} />);
        expect(screen.getByText('Undone')).toBeTruthy();
        expect(screen.queryByText('Undo all')).toBeNull();
    });
});

describe('ChangesCard new action types', () => {
    it('renders project/area/tag/merge/plan rows with kind labels and plan details', () => {
        const entries = [
            entry('p', "Renamed project 'A' to 'B'", { kind: 'project' }),
            entry('a', "Created area 'Home'", { kind: 'area' }),
            entry('t', 'Renamed #a to #b on 2 tasks', { kind: 'tag' }),
            entry('m', "Merged 'X' into 'Y'", { kind: 'merge' }),
            entry('b', 'Rename 1, merge 1 \u00b7 2 of 2 steps', { kind: 'plan', details: ['step one', 'step two'] }),
        ];
        render(<ChangesCard entries={entries} onUndo={vi.fn()} onUndoAll={vi.fn()} />);
        for (const label of ['Project', 'Area', 'Tags', 'Merged', 'Batch plan']) expect(screen.getByText(label)).toBeTruthy();
        expect(screen.getByText('step two')).toBeTruthy();
    });
});

describe('ConfirmCard', () => {
    const pending: PendingConfirmation = {
        id: 'p1', messageId: 't1', toolName: 'delete_task', args: {}, reason: 'Deleting', summary: 'Delete 2 tasks',
        affected: [{ id: '1', title: 'A very long task title that must wrap and not be truncated at all' }], status: 'pending', createdAt: '',
    };

    it('confirms and declines', () => {
        const onConfirm = vi.fn();
        const onReject = vi.fn();
        render(<ConfirmCard pending={pending} onConfirm={onConfirm} onReject={onReject} />);
        expect(screen.getByText('Needs your confirmation')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
        fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
        expect(onConfirm).toHaveBeenCalledWith('p1');
        expect(onReject).toHaveBeenCalledWith('p1');
    });

    it('hides buttons once resolved', () => {
        render(<ConfirmCard pending={{ ...pending, status: 'confirmed' }} onConfirm={vi.fn()} onReject={vi.fn()} />);
        expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
    });
});

describe('SuggestionChips', () => {
    it('sends the chip text on click', () => {
        const onPick = vi.fn();
        render(<SuggestionChips suggestions={['Plan my day', 'Find duplicates']} onPick={onPick} />);
        fireEvent.click(screen.getByText('Find duplicates'));
        expect(onPick).toHaveBeenCalledWith('Find duplicates');
    });
});

describe('DeclineCard', () => {
    const text = "I'm here for your tasks and plans, so I'll skip that one. Want me to capture 'Build a calculator app' as a task instead?";

    it('shows the one-line decline and a Capture as task chip', () => {
        const onCapture = vi.fn();
        render(<DeclineCard text={text} decline={{ reason: 'calculator code', suggestedTask: 'Build a calculator app' }} onCapture={onCapture} />);
        expect(screen.getByTestId('assistant-decline-card').textContent).toContain(text);
        fireEvent.click(screen.getByRole('button', { name: 'Capture as task: Build a calculator app' }));
        expect(onCapture).toHaveBeenCalledTimes(1);
    });

    it('shows Added to Inbox once captured, and no chip without a suggested task', () => {
        const { rerender } = render(<DeclineCard text={text} decline={{ reason: 'x', suggestedTask: 'Build a calculator app', captured: true }} onCapture={vi.fn()} />);
        expect(screen.getByTestId('assistant-decline-captured').textContent).toBe('Added to Inbox');
        expect(screen.queryByRole('button')).toBeNull();
        rerender(<DeclineCard text="I'm here for your tasks and plans, so I'll skip that one." decline={{ reason: 'jailbreak' }} onCapture={vi.fn()} />);
        expect(screen.queryByRole('button')).toBeNull();
    });
});
