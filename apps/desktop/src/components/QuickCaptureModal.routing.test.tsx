import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';

import type { MindSweepProposal } from '@stride/core';
import { QuickCaptureModal } from './QuickCaptureModal';

vi.mock('../contexts/language-context', () => ({
    useLanguage: () => ({ t: (key: string) => key, language: 'en' }),
}));

const proposal: MindSweepProposal = {
    source: 'ai',
    summary: 'Organised.',
    projects: [],
    items: [
        { key: 'i1', title: 'Send quotation to Akash', kind: 'next', areaName: 'Mauvi Labs', reason: 'mentions Akash → Mauvi Labs' },
        { key: 'i2', title: 'Call about the thing', kind: 'next', needsArea: true },
        { key: 'i3', title: 'Buy milk', kind: 'next' },
    ],
};

const open = async (onCorrection = vi.fn()) => {
    const generate = vi.fn().mockResolvedValue(proposal);
    const apply = vi.fn().mockResolvedValue({ projectIds: [], taskIds: ['a', 'b', 'c'], failed: [] });
    const view = render(
        <QuickCaptureModal isOpen onClose={vi.fn()} generate={generate} apply={apply} undo={vi.fn()}
            areaNames={['Mauvi Labs', 'Frackly Works', 'Prad']} onCorrection={onCorrection} />,
    );
    fireEvent.change(view.getByRole('textbox'), { target: { value: 'dump' } });
    fireEvent.click(view.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(view.getByText('Organised.')).toBeInTheDocument());
    return { view, apply, onCorrection };
};

describe('QuickCaptureModal routing', () => {
    it('shows the AI reason subtly next to its area choice', async () => {
        const { view } = await open();
        expect(view.getByText('Why: mentions Akash → Mauvi Labs')).toBeInTheDocument();
        expect(view.getByRole('button', { name: 'Remove area Mauvi Labs' })).toBeInTheDocument();
    });

    it('asks "Which area?" with chips only where the AI was unsure', async () => {
        const { view, apply, onCorrection } = await open();
        const group = view.getByRole('group', { name: 'Which area? Call about the thing' });
        expect(view.queryByRole('group', { name: 'Which area? Buy milk' })).not.toBeInTheDocument();
        fireEvent.click(group.querySelector('button')!.parentElement!.querySelectorAll('button')[1]);
        expect(view.queryByRole('group', { name: 'Which area? Call about the thing' })).not.toBeInTheDocument();
        fireEvent.click(view.getByRole('button', { name: 'Add 3 items' }));
        await waitFor(() => expect(apply).toHaveBeenCalled());
        const item = apply.mock.calls[0][0].items.find((i: { key: string }) => i.key === 'i2');
        expect(item.areaName).toBe('Frackly Works');
        expect(item).not.toHaveProperty('aiAreaName');
        expect(onCorrection).toHaveBeenCalledWith({ text: 'Call about the thing', toArea: 'Frackly Works' });
    });

    it('records a correction when the user changes an AI-assigned area, and hides the stale reason', async () => {
        const { view, onCorrection } = await open();
        fireEvent.click(view.getByRole('button', { name: 'Remove area Mauvi Labs' }));
        expect(view.queryByText('Why: mentions Akash → Mauvi Labs')).not.toBeInTheDocument();
        const group = view.getByRole('group', { name: 'Which area? Send quotation to Akash' });
        fireEvent.click(Array.from(group.querySelectorAll('button')).find((b) => b.textContent === 'Prad')!);
        fireEvent.click(view.getByRole('button', { name: 'Add 3 items' }));
        await waitFor(() => expect(onCorrection).toHaveBeenCalledWith({ text: 'Send quotation to Akash', fromArea: 'Mauvi Labs', toArea: 'Prad' }));
    });

    it('does not record anything when the AI choice is kept', async () => {
        const { view, onCorrection, apply } = await open();
        fireEvent.click(view.getAllByRole('checkbox')[1]);
        fireEvent.click(view.getByRole('button', { name: 'Add 2 items' }));
        await waitFor(() => expect(apply).toHaveBeenCalled());
        expect(onCorrection).not.toHaveBeenCalled();
    });
});
