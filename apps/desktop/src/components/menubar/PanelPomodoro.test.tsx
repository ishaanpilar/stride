import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useTaskStore, type Task } from '@stride/core';
import { usePomodoroStore } from '../../store/pomodoro-store';
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
});
