import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useTaskStore, type Task } from '@stride/core';
import { DESKTOP_POMODORO_SESSION_STORAGE_KEY, usePomodoroStore } from '../../store/pomodoro-store';
import { PanelPomodoro } from './PanelPomodoro';
import { FOCUS_PRESENTATION_STORAGE_KEY } from '../../store/focus-session-store';

const nowIso = '2026-07-01T12:00:00.000Z';
const task: Task = {
    id: 't1', title: 'Write RFC reply', status: 'next', tags: [], contexts: [], createdAt: nowIso, updatedAt: nowIso,
    checklist: [
        { id: 'a', title: 'Outline', isCompleted: true },
        { id: 'b', title: 'Draft', isCompleted: false },
    ],
};
const tr = (_key: string, fallback: string) => fallback;

describe('PanelPomodoro', () => {
    beforeEach(() => {
        window.localStorage.clear();
        useTaskStore.setState({ tasks: [task], _allTasks: [task], settings: {} } as never);
        usePomodoroStore.getState().hydratePomodoro({});
    });

    it('is one compact row: ring with time, task line and Start; no preset control or helper text', () => {
        render(<PanelPomodoro candidates={[task]} tr={tr} />);
        expect(screen.getByTestId('pomodoro-ring')).toHaveAttribute('data-phase', 'focus');
        expect(screen.getByTestId('panel-pomodoro-clock').textContent).toBe('25:00');
        expect(screen.queryByRole('radiogroup')).toBeNull();
        expect(screen.queryByText('What will you focus on?')).toBeNull();
        expect(screen.queryByText(/Everything else will dim/)).toBeNull();
        expect(screen.queryByRole('button', { name: 'Reset' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Timer task' }).textContent).toBe('Choose a task');
    });

    it('Start starts the shared timer; running shows only ring, task name and pause', () => {
        render(<PanelPomodoro candidates={[task]} tr={tr} />);
        fireEvent.click(screen.getByRole('button', { name: 'Timer task' }));
        fireEvent.click(screen.getByRole('button', { name: 'Write RFC reply' }));
        fireEvent.click(screen.getByRole('button', { name: 'Start' }));
        const snapshot = usePomodoroStore.getState().snapshot;
        expect(snapshot.timerState.isRunning).toBe(true);
        // The main window auto-opens Focus mode from this shared snapshot (running focus + task).
        expect(snapshot.selectedTaskId).toBe('t1');
        expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Start' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Timer task' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Session length' })).toBeNull();
        expect(screen.getByText('Write RFC reply')).toBeInTheDocument();
        expect(screen.queryByTestId('panel-focus-step')).toBeNull();
    });

    it('while focus runs, shows a quiet "Now" line from the focus session (step or coach suggestion)', () => {
        window.localStorage.setItem('stride:focus:now:v1', JSON.stringify({ taskId: 't1', text: 'Call a repair service' }));
        render(<PanelPomodoro candidates={[task]} tr={tr} />);
        expect(screen.queryByTestId('panel-focus-step')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Timer task' }));
        fireEvent.click(screen.getByRole('button', { name: 'Write RFC reply' }));
        fireEvent.click(screen.getByRole('button', { name: 'Start' }));
        expect(screen.getByTestId('panel-focus-step')).toHaveTextContent('Now: Call a repair service');
        window.localStorage.setItem('stride:focus:now:v1', JSON.stringify({ taskId: 'other', text: 'Something else' }));
        fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
        fireEvent.click(screen.getByRole('button', { name: 'Start' }));
        expect(screen.queryByTestId('panel-focus-step')).toBeNull();
    });

    it('chooses a preset by tapping the time', () => {
        render(<PanelPomodoro candidates={[task]} tr={tr} />);
        fireEvent.click(screen.getByRole('button', { name: 'Session length' }));
        expect(screen.getByRole('radio', { name: /Classic\s*25\/5/ })).toHaveAttribute('aria-checked', 'true');
        fireEvent.click(screen.getByRole('radio', { name: /Quick/ }));
        expect(usePomodoroStore.getState().snapshot.durations.focusMinutes).toBe(15);
        expect(screen.getByTestId('panel-pomodoro-clock').textContent).toBe('15:00');
        expect(screen.queryByRole('radiogroup')).toBeNull();
    });
    it('reflects a minimised or hidden Focus mode with a Back to focus button, and nothing extra when it is full', () => {
        const view = render(<PanelPomodoro candidates={[task]} tr={tr} />);
        fireEvent.click(screen.getByRole('button', { name: 'Timer task' }));
        fireEvent.click(screen.getByRole('button', { name: 'Write RFC reply' }));
        window.localStorage.setItem(FOCUS_PRESENTATION_STORAGE_KEY, 'full');
        fireEvent.click(screen.getByRole('button', { name: 'Start' }));
        expect(screen.queryByTestId('panel-back-to-focus')).toBeNull();
        window.localStorage.setItem(FOCUS_PRESENTATION_STORAGE_KEY, 'mini');
        view.rerender(<PanelPomodoro candidates={[task]} tr={tr} />);
        expect(screen.getByRole('button', { name: 'Back to focus' })).toBeInTheDocument();
        window.localStorage.setItem(FOCUS_PRESENTATION_STORAGE_KEY, 'hidden');
        view.rerender(<PanelPomodoro candidates={[task]} tr={tr} />);
        expect(screen.getByRole('button', { name: 'Back to focus' })).toBeInTheDocument();
        window.localStorage.removeItem(FOCUS_PRESENTATION_STORAGE_KEY);
        view.rerender(<PanelPomodoro candidates={[task]} tr={tr} />);
        expect(screen.queryByTestId('panel-back-to-focus')).toBeNull();
    });

    it('idle shows "25 min ⌄" under the time; it opens the presets with the explainer', () => {
        render(<PanelPomodoro candidates={[task]} tr={tr} />);
        expect(screen.getByTestId('panel-pomodoro-preset-label')).toHaveTextContent('25 min');
        fireEvent.click(screen.getByTestId('panel-pomodoro-preset-label'));
        expect(screen.getByTestId('pomodoro-preset-hint')).toHaveTextContent('Focus minutes / break minutes');
        fireEvent.click(screen.getByRole('radio', { name: /Deep/ }));
        expect(screen.getByTestId('panel-pomodoro-preset-label')).toHaveTextContent('50 min');
    });

    it('picks up a change another window saved (e.g. Pause or added time in another window)', () => {
        render(<PanelPomodoro candidates={[task]} tr={tr} />);
        fireEvent.click(screen.getByRole('button', { name: 'Start' }));
        const stored = JSON.parse(window.localStorage.getItem(DESKTOP_POMODORO_SESSION_STORAGE_KEY) ?? '{}');
        stored.timerState = { ...stored.timerState, remainingSeconds: 1800, phaseTotalSeconds: 1800, extendedSeconds: 300 };
        stored.updatedAtMs = Date.now();
        window.localStorage.setItem(DESKTOP_POMODORO_SESSION_STORAGE_KEY, JSON.stringify(stored));
        act(() => { window.dispatchEvent(new StorageEvent('storage', { key: DESKTOP_POMODORO_SESSION_STORAGE_KEY })); });
        expect(screen.getByTestId('panel-pomodoro-clock').textContent).toMatch(/^(29:59|30:00)$/);
    });

    it('overtime: the row counts up in a calmer tone; Pause and check in ends the session', () => {
        render(<PanelPomodoro candidates={[task]} tr={tr} />);
        act(() => {
            usePomodoroStore.getState().commitPomodoro((prev) => ({
                ...prev,
                selectedTaskId: 't1',
                timerState: { ...prev.timerState, isRunning: true, remainingSeconds: 0, overtimeSeconds: 65, keepGoing: true },
                updatedAtMs: Date.now(),
            }));
        });
        const clock = screen.getByTestId('panel-pomodoro-clock');
        expect(clock).toHaveTextContent('+1:05');
        expect(clock).toHaveAttribute('data-overtime', 'true');
        expect(screen.getByTestId('pomodoro-ring')).toHaveAttribute('data-overtime', 'true');
        fireEvent.click(screen.getByRole('button', { name: 'Pause and check in' }));
        expect(usePomodoroStore.getState().snapshot.lastEvent).toBe('focus-finished');
        expect(usePomodoroStore.getState().snapshot.timerState.phase).toBe('break');
    });
});
