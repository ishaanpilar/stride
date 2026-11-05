import { act, fireEvent, render } from '@testing-library/react';
import type { Task } from '@stride/core';
import { useTaskStore } from '@stride/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../contexts/language-context';
import { KeybindingProvider } from '../../contexts/keybinding-context';
import { useUiStore } from '../../store/ui-store';
import { resetCompletionRetentionForTests } from '../../lib/completion-retention';
import { COMPLETION_TIMELINE, resetCompletionSequenceForTests } from '../../lib/completion-sequence';
import { ListView } from './ListView';

vi.mock('../../lib/report-error', () => ({ reportError: vi.fn() }));

const initialTaskState = useTaskStore.getState();
const initialUiState = useUiStore.getState();
const now = new Date().toISOString();
const makeTask = (id: string, overrides: Partial<Task> = {}): Task => ({
  id, title: `Task ${id}`, status: 'next', tags: [], contexts: [], createdAt: now, updatedAt: now, ...overrides,
});

const renderNext = () => render(
  <LanguageProvider>
    <KeybindingProvider currentView="next" onNavigate={() => {}}>
      <ListView title="Next" statusFilter="next" />
    </KeybindingProvider>
  </LanguageProvider>,
);

const titles = (view: ReturnType<typeof renderNext>) => (
  Array.from(view.container.querySelectorAll('[data-task-id]')).map((el) => el.getAttribute('data-task-id'))
);

const setTasks = (tasks: Task[]) => act(() => {
  useTaskStore.setState({ _allTasks: tasks, lastDataChangeAt: Date.now() });
});

describe('ListView completion and manual order', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetCompletionRetentionForTests();
    resetCompletionSequenceForTests();
    useTaskStore.setState(initialTaskState, true);
    useUiStore.setState(initialUiState, true);
    useTaskStore.setState({ _allTasks: [], _allProjects: [], _allAreas: [], settings: {}, lastDataChangeAt: 0 });
  });

  it('keeps a task ticked done in the list, struck through, then moves it to the bottom', async () => {
    const a = makeTask('a', { createdAt: '2026-01-01T00:00:00.000Z' });
    const b = makeTask('b', { createdAt: '2026-01-02T00:00:00.000Z' });
    const c = makeTask('c', { createdAt: '2026-01-03T00:00:00.000Z' });
    setTasks([a, b, c]);
    const view = renderNext();
    expect(titles(view)).toEqual(['a', 'b', 'c']);

    vi.useFakeTimers();
    setTasks([a, { ...b, status: 'done', completedAt: now }, c]);
    // Still present, still in place while the completion sequence plays (pop, strike, hold, leave).
    expect(titles(view)).toEqual(['a', 'b', 'c']);
    expect(view.getByText('Task b').className).toContain('completion-strike');

    act(() => { vi.advanceTimersByTime(COMPLETION_TIMELINE.leaving + 50); });
    expect(titles(view)).toEqual(['a', 'b', 'c']);
    act(() => { vi.advanceTimersByTime(COMPLETION_TIMELINE.gone - COMPLETION_TIMELINE.leaving); });
    vi.useRealTimers();
    expect(titles(view)).toEqual(['a', 'c', 'b']);
    expect(view.getByText('Task b').className).toContain('completion-strike');

    // Unticking restores it to its place.
    setTasks([a, { ...b, status: 'next', completedAt: undefined }, c]);
    expect(titles(view)).toEqual(['a', 'b', 'c']);
  });

  it('does not show tasks completed before this session', () => {
    setTasks([makeTask('a'), makeTask('old', { status: 'done', completedAt: now })]);
    const view = renderNext();
    expect(titles(view)).toEqual(['a']);
  });

  it('reorders by dropping a row in the default sort, switches to Manual and offers Undo', () => {
    const reorderBoardTasks = vi.fn().mockResolvedValue(undefined);
    useTaskStore.setState({ reorderBoardTasks } as never);
    setTasks([
      makeTask('a', { createdAt: '2026-01-01T00:00:00.000Z' }),
      makeTask('b', { createdAt: '2026-01-02T00:00:00.000Z' }),
      makeTask('c', { createdAt: '2026-01-03T00:00:00.000Z' }),
    ]);
    const view = renderNext();
    const rowOf = (id: string) => view.container.querySelector<HTMLElement>(`[data-reorder-row="${id}"]`)!;
    const dataTransfer = { setData: vi.fn(), getData: vi.fn(), effectAllowed: 'move', dropEffect: 'move', types: [] };

    const cardC = view.container.querySelector<HTMLElement>('[data-task-id="c"]')!;
    fireEvent.dragStart(cardC, { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith('application/x-stride-task-id', 'c');
    fireEvent.dragOver(rowOf('a'), { dataTransfer, clientY: 10 });
    expect(view.container.querySelector('[data-reorder-drop-line="bottom"]')).not.toBeNull();
    fireEvent.drop(rowOf('a'), { dataTransfer, clientY: 10 });

    expect(reorderBoardTasks).toHaveBeenCalledWith('next', ['a', 'c', 'b'], 'c');
    expect(window.localStorage.getItem('stride:view:manual-order:next:v1')).toBe('1');
    const toast = useUiStore.getState().toasts.slice(-1)[0];
    expect(toast?.message).toBe('Switched to manual order');
    act(() => { toast?.action?.onClick(); });
    expect(window.localStorage.getItem('stride:view:manual-order:next:v1')).toBeNull();
    expect(reorderBoardTasks).toHaveBeenLastCalledWith('next', ['a', 'b', 'c']);
  });

  it('does not start a row drag from the complete button', () => {
    setTasks([makeTask('a'), makeTask('b')]);
    const view = renderNext();
    const card = view.container.querySelector<HTMLElement>('[data-task-id="a"]')!;
    const complete = card.querySelector<HTMLElement>('[data-task-complete]')!;
    const dataTransfer = { setData: vi.fn(), getData: vi.fn(), effectAllowed: 'move', dropEffect: 'move', types: [] };
    fireEvent.pointerDown(complete);
    const allowed = fireEvent.dragStart(card, { dataTransfer });
    expect(allowed).toBe(false);
    expect(dataTransfer.setData).not.toHaveBeenCalled();
    expect(view.container.querySelector('[data-reorder-row="a"]')?.className).not.toContain('opacity-50');
  });

  it('nudges a focused row with Alt+ArrowUp', () => {
    const reorderBoardTasks = vi.fn().mockResolvedValue(undefined);
    useTaskStore.setState({ reorderBoardTasks } as never);
    setTasks([
      makeTask('a', { createdAt: '2026-01-01T00:00:00.000Z' }),
      makeTask('b', { createdAt: '2026-01-02T00:00:00.000Z' }),
    ]);
    const view = renderNext();
    fireEvent.keyDown(view.container.querySelector('[data-task-id="b"]')!, { key: 'ArrowUp', altKey: true });
    expect(reorderBoardTasks).toHaveBeenCalledWith('next', ['b', 'a'], 'b');
  });
});
