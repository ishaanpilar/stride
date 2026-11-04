import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';

import type { MindSweepProposal } from '@stride/core';
import { QuickCaptureModal } from './QuickCaptureModal';

vi.mock('../contexts/language-context', () => ({
    useLanguage: () => ({ t: (key: string) => key, language: 'en' }),
}));

const proposal: MindSweepProposal = {
    source: 'ai',
    summary: 'Organised 3 things.',
    projects: [{ ref: 'p1', title: 'Plan trip' }],
    items: [
        { key: 'i1', title: 'Book flights', kind: 'next', projectRef: 'p1', dueDate: '2026-11-10' },
        { key: 'i2', title: 'Chase invoice', kind: 'waiting', waitingFor: 'Raj' },
        { key: 'i3', title: 'Learn piano', kind: 'someday' },
    ],
};

const setup = (overrides: Partial<React.ComponentProps<typeof QuickCaptureModal>> = {}) => {
    const generate = vi.fn().mockResolvedValue(proposal);
    const apply = vi.fn().mockResolvedValue({ projectIds: ['np'], taskIds: ['a', 'b'], failed: [] });
    const undo = vi.fn().mockResolvedValue(true);
    const onClose = vi.fn();
    const utils = render(<QuickCaptureModal isOpen onClose={onClose} generate={generate} apply={apply} undo={undo} {...overrides} />);
    return { ...utils, generate, apply, undo, onClose };
};

describe('QuickCaptureModal', () => {
    it('step 1 is a single textarea; Next is disabled until text exists', () => {
        const { getByRole } = setup();
        expect(getByRole('textbox')).toBeInTheDocument();
        expect(getByRole('button', { name: 'Next' })).toBeDisabled();
    });

    it('reviews the proposal grouped, lets rows be excluded, and adds the rest', async () => {
        const { getByRole, getByText, getAllByText, getAllByRole, generate, apply } = setup();
        fireEvent.change(getByRole('textbox'), { target: { value: 'trip, invoice, piano' } });
        fireEvent.keyDown(getByRole('textbox'), { key: 'Enter', metaKey: true });
        await waitFor(() => expect(getByText('Organised 3 things.')).toBeInTheDocument());
        expect(generate).toHaveBeenCalledWith('trip, invoice, piano');
        expect(getByText('Plan trip')).toBeInTheDocument();
        expect(getAllByText('Waiting for').length).toBeGreaterThan(0);
        expect(getByRole('button', { name: 'Add 3 items' })).toBeInTheDocument();

        fireEvent.click(getAllByRole('checkbox')[2]);
        expect(getByRole('button', { name: 'Add 2 items' })).toBeInTheDocument();

        fireEvent.click(getByRole('button', { name: 'Add 2 items' }));
        await waitFor(() => expect(getByText('Added 2 tasks and 1 projects')).toBeInTheDocument());
        const arg = apply.mock.calls[0][0];
        expect(arg.items.map((i: { title: string }) => i.title)).toEqual(['Book flights', 'Chase invoice']);
    });

    it('Back keeps the text; Undo reverts the sweep', async () => {
        const { getByRole, getByText, undo } = setup();
        fireEvent.change(getByRole('textbox'), { target: { value: 'keep me' } });
        fireEvent.click(getByRole('button', { name: 'Next' }));
        await waitFor(() => getByText('Organised 3 things.'));
        fireEvent.click(getByRole('button', { name: 'Back' }));
        expect(getByRole('textbox')).toHaveValue('keep me');
        fireEvent.click(getByRole('button', { name: 'Next' }));
        await waitFor(() => getByText('Organised 3 things.'));
        fireEvent.click(getByRole('button', { name: 'Add 3 items' }));
        await waitFor(() => getByRole('button', { name: 'Undo' }));
        fireEvent.click(getByRole('button', { name: 'Undo' }));
        await waitFor(() => expect(getByText('Undone')).toBeInTheDocument());
        expect(undo).toHaveBeenCalledWith({ projectIds: ['np'], taskIds: ['a', 'b'], failed: [] });
    });

    it('shows the AI-off note on fallback proposals', async () => {
        const generate = vi.fn().mockResolvedValue({
            source: 'fallback', fallbackReason: 'disabled', summary: '', projects: [],
            items: [{ key: 'i1', title: 'Buy milk', kind: 'inbox' }],
        });
        const { getByRole, getByText } = setup({ generate, onOpenAiSettings: vi.fn() });
        fireEvent.change(getByRole('textbox'), { target: { value: 'Buy milk' } });
        fireEvent.click(getByRole('button', { name: 'Next' }));
        await waitFor(() => expect(getByText(/AI is off/)).toBeInTheDocument());
        expect(getByRole('button', { name: 'Settings → AI' })).toBeInTheDocument();
    });
});
