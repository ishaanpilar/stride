import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { useTaskStore, type Task } from '@stride/core';
import { LanguageProvider } from '../../contexts/language-context';
import { useUiStore } from '../../store/ui-store';
import { resetCompletionRetentionForTests } from '../../lib/completion-retention';
import { COMPLETION_TIMELINE, getCompletionPhase, resetCompletionSequenceForTests } from '../../lib/completion-sequence';
import { AgendaView } from './AgendaView';

vi.mock('../../lib/report-error', () => ({ reportError: vi.fn() }));

const nowIso = new Date().toISOString();
const focused = (id: string, order: number): Task => ({
    id, title: `Focus ${id}`, status: 'next', isFocusedToday: true, focusOrder: order,
    tags: [], contexts: [], createdAt: nowIso, updatedAt: nowIso,
});

const focusRowIds = (container: HTMLElement) => Array.from(
    container.querySelectorAll('[data-testid="todays-focus-section"] [data-task-id]'),
).map((element) => element.getAttribute('data-task-id')).filter((id, index, all) => all.indexOf(id) === index);

describe('AgendaView completion sequence', () => {
    const initialUi = useUiStore.getState();
    beforeEach(() => {
        window.localStorage.clear();
        resetCompletionRetentionForTests();
        resetCompletionSequenceForTests();
        useUiStore.setState(initialUi, true);
        const tasks = [focused('a', 0), focused('b', 1), focused('c', 2)];
        useTaskStore.setState({
            tasks, _allTasks: tasks, projects: [], _allProjects: [], areas: [], _allAreas: [],
            settings: { deviceId: 'test-device' }, error: null, highlightTaskId: null, lastDataChangeAt: 0,
        });
    });
    afterEach(() => {
        resetCompletionSequenceForTests();
        vi.useRealTimers();
    });

    it("keeps the very first tick in Today's Focus on screen, in place, until its sequence ends, then at the bottom", async () => {
        const view = render(<LanguageProvider><AgendaView /></LanguageProvider>);
        expect(focusRowIds(view.container)).toEqual(['a', 'b', 'c']);

        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
        const tick = view.container.querySelector('[data-task-id="a"] [data-task-complete]') as HTMLElement;
        await act(async () => {
            fireEvent.click(tick);
            await Promise.resolve();
        });
        expect(useTaskStore.getState()._allTasks.find((task) => task.id === 'a')?.status).toBe('done');

        // The store already has it done; the row is still there, first, playing its sequence.
        const row = () => view.container.querySelector('[data-testid="todays-focus-section"] [data-task-id="a"]');
        expect(row()).not.toBeNull();
        expect(row()).toHaveAttribute('data-completion', 'popping');
        expect(focusRowIds(view.container)).toEqual(['a', 'b', 'c']);

        await act(async () => { vi.advanceTimersByTime(COMPLETION_TIMELINE.holding + 10); });
        expect(row()).toHaveAttribute('data-completion', 'holding');
        expect(row()?.querySelector('[data-task-title-struck]')).not.toBeNull();
        expect(focusRowIds(view.container)).toEqual(['a', 'b', 'c']);

        await act(async () => { vi.advanceTimersByTime(COMPLETION_TIMELINE.leaving - COMPLETION_TIMELINE.holding); });
        expect(row()).toHaveAttribute('data-completion', 'leaving');
        expect(focusRowIds(view.container)).toEqual(['a', 'b', 'c']);

        await act(async () => { vi.advanceTimersByTime(COMPLETION_TIMELINE.gone - COMPLETION_TIMELINE.leaving); });
        expect(getCompletionPhase('a')).toBe('gone');
        expect(focusRowIds(view.container)).toEqual(['b', 'c', 'a']);
    });

    it('ignores a fast second click on the same checkbox', async () => {
        const moveTask = vi.fn().mockResolvedValue({ success: true });
        useTaskStore.setState({ moveTask } as never);
        const view = render(<LanguageProvider><AgendaView /></LanguageProvider>);
        const tick = view.container.querySelector('[data-task-id="b"] [data-task-complete]') as HTMLElement;
        await act(async () => {
            fireEvent.click(tick);
            fireEvent.click(tick);
            await Promise.resolve();
        });
        expect(moveTask).toHaveBeenCalledTimes(1);
        expect(moveTask).toHaveBeenCalledWith('b', 'done');
    });
});
