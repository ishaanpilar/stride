import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, waitFor } from '@testing-library/react';

vi.mock('../../contexts/language-context', () => ({
    useLanguage: () => ({ t: (key: string) => key, language: 'en' }),
}));
vi.mock('../../lib/speech-to-text', () => ({
    resolveSpeechCapture: vi.fn().mockResolvedValue({ ready: false, reason: 'disabled', config: { provider: 'whisper', model: 'base' } }),
    processAudioCapture: vi.fn(),
}));

import { CaptureBar } from './CaptureBar';
import { openCapture, registerInboxComposer } from '../../lib/inline-capture';
import { useUiStore } from '../../store/ui-store';

describe('CaptureBar', () => {
    beforeEach(() => {
        useUiStore.setState({ toasts: [] });
    });

    it('opens from openCapture when the Inbox composer is not on screen, and Esc closes it', async () => {
        const { queryByRole, findByRole } = render(<CaptureBar save={vi.fn()} />);
        expect(queryByRole('dialog')).toBeNull();
        act(() => { openCapture({ fromTrigger: true }); });
        const dialog = await findByRole('dialog', { name: 'Capture' });
        const input = await findByRole('textbox', { name: 'What’s on your mind?' });
        await waitFor(() => expect(document.activeElement).toBe(input));
        fireEvent.keyDown(input, { key: 'Escape' });
        await waitFor(() => expect(queryByRole('dialog')).toBeNull());
        expect(dialog.isConnected).toBe(false);
    });

    it('saves straight to the Inbox, closes and confirms with a toast', async () => {
        const save = vi.fn().mockResolvedValue({ saved: 2, failed: 0, taskIds: ['a', 'b'] });
        const { findByRole, queryByRole } = render(<CaptureBar save={save} />);
        act(() => { openCapture(); });
        const input = await findByRole('textbox', { name: 'What’s on your mind?' });
        fireEvent.change(input, { target: { value: 'one\ntwo' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        await waitFor(() => expect(save).toHaveBeenCalledWith('one\ntwo'));
        await waitFor(() => expect(queryByRole('dialog')).toBeNull());
        expect(useUiStore.getState().toasts.slice(-1)[0]?.message).toBe('Added 2 items to Inbox');
    });

    it('focuses the Inbox composer in place instead of opening the bar', () => {
        const focus = vi.fn();
        const unregister = registerInboxComposer({ focus, isVisible: () => true });
        const { queryByRole } = render(<CaptureBar save={vi.fn()} />);
        let target: string | undefined;
        act(() => { target = openCapture({ fromTrigger: true }); });
        expect(target).toBe('inbox');
        expect(focus).toHaveBeenCalledWith({ fromTrigger: true });
        expect(queryByRole('dialog')).toBeNull();
        unregister();
    });
});
