import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../lib/assistant-service', () => ({
    getAssistantReadiness: vi.fn(async () => ({ ready: true })),
    createAssistantClient: vi.fn(),
    createStoreAssistantPort: vi.fn(),
}));

import { LanguageProvider } from '../contexts/language-context';
import { AssistantDock } from './AssistantDock';
import { useAssistantShortcut } from '../hooks/useAssistantShortcut';
import {
    ASSISTANT_DOCK_STORAGE_KEY,
    useAssistantDockStore,
} from '../store/assistant-dock-store';

function Harness({ narrow = false }: { narrow?: boolean }) {
    useAssistantShortcut(
        () => useAssistantDockStore.getState().openAndFocus(narrow),
        () => useAssistantDockStore.getState().toggle(narrow),
    );
    return <LanguageProvider><AssistantDock narrow={narrow} padForTitlebar /></LanguageProvider>;
}

describe('AssistantDock', () => {
    beforeEach(() => {
        window.localStorage.clear();
        useAssistantDockStore.getState().reload();
    });
    afterEach(() => cleanup());

    it('is open by default with the default width and shows suggestion chips', async () => {
        render(<Harness />);
        const dock = await screen.findByTestId('assistant-dock');
        expect(dock.style.width).toBe('380px');
        expect(await screen.findByText('Plan my day')).toBeTruthy();
        expect(screen.getByText('Triage my inbox')).toBeTruthy();
    });

    it('suggestion chips send the suggestion as the next message', async () => {
        render(<Harness />);
        fireEvent.click(await screen.findByText('Plan my day'));
        expect(await screen.findByText('Plan my day', { selector: 'p, div, span' })).toBeTruthy();
        expect(screen.queryByTestId('assistant-empty-state')).toBeNull();
    });

    it('collapses via the header button and persists closed state', async () => {
        render(<Harness />);
        fireEvent.click(await screen.findByLabelText('Collapse assistant'));
        expect(screen.queryByTestId('assistant-dock')).toBeNull();
        expect(JSON.parse(window.localStorage.getItem(ASSISTANT_DOCK_STORAGE_KEY) ?? '{}').open).toBe(false);
        useAssistantDockStore.getState().reload();
        expect(useAssistantDockStore.getState().open).toBe(false);
    });

    it('clamps and persists width from the keyboard resize handle', async () => {
        render(<Harness />);
        const handle = await screen.findByRole('separator', { name: 'Resize assistant' });
        for (let i = 0; i < 20; i++) fireEvent.keyDown(handle, { key: 'ArrowLeft' });
        expect(useAssistantDockStore.getState().width).toBe(560);
        for (let i = 0; i < 40; i++) fireEvent.keyDown(handle, { key: 'ArrowRight' });
        expect(useAssistantDockStore.getState().width).toBe(320);
        expect(JSON.parse(window.localStorage.getItem(ASSISTANT_DOCK_STORAGE_KEY) ?? '{}').width).toBe(320);
    });

    it('Cmd+Shift+J opens a closed dock and focuses the composer', async () => {
        useAssistantDockStore.getState().setOpen(false);
        render(<Harness />);
        expect(screen.queryByTestId('assistant-dock')).toBeNull();
        act(() => { fireEvent.keyDown(window, { key: 'j', metaKey: true, shiftKey: true }); });
        const input = await screen.findByLabelText('Message the assistant');
        await vi.waitFor(() => expect(document.activeElement).toBe(input));
    });

    it('Cmd+\\ toggles the dock', async () => {
        render(<Harness />);
        await screen.findByTestId('assistant-dock');
        act(() => { fireEvent.keyDown(window, { key: '\\', metaKey: true }); });
        expect(screen.queryByTestId('assistant-dock')).toBeNull();
    });

    it('renders an overlay drawer when narrow, closed until requested', async () => {
        render(<Harness narrow />);
        expect(screen.queryByTestId('assistant-drawer')).toBeNull();
        act(() => { fireEvent.keyDown(window, { key: 'j', ctrlKey: true, shiftKey: true }); });
        expect(await screen.findByTestId('assistant-drawer')).toBeTruthy();
        act(() => { fireEvent.keyDown(window, { key: 'Escape' }); });
        expect(screen.queryByTestId('assistant-drawer')).toBeNull();
    });
});
