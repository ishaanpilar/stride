import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { getPomodoroLocalDayKey, loadTranslations, useTaskStore, type Task } from '@stride/core';
import { LanguageProvider } from '../../contexts/language-context';
import * as languageContext from '../../contexts/language-context';
import { useUiStore } from '../../store/ui-store';
import { usePomodoroStore } from '../../store/pomodoro-store';
import { DESKTOP_POMODORO_SESSION_STORAGE_KEY, PomodoroPanel } from './PomodoroPanel';
import { resetFocusSessionStore, useFocusSessionStore } from '../../store/focus-session-store';
const nowIso = '2026-07-01T12:00:00.000Z';
const task: Task = {
    id: 'task-1',
    title: 'Write RFC reply',
    status: 'next',
    tags: [],
    contexts: [],
    createdAt: nowIso,
    updatedAt: nowIso,
};

const renderPanel = () => render(
    <LanguageProvider>
        <PomodoroPanel tasks={[task]} />
    </LanguageProvider>
);

describe('PomodoroPanel desktop persistence', () => {
    beforeEach(() => {
        window.localStorage.clear();
        useTaskStore.setState({
            tasks: [task],
            _allTasks: [task],
            settings: {
                gtd: {
                    pomodoro: {
                        linkTask: true,
                    },
                },
            },
            error: null,
            highlightTaskId: null,
        });
        usePomodoroStore.getState().hydratePomodoro({});
    });

    it('localizes both phases and switch directions with the shared Chinese labels (#1367)', async () => {
        const translations = await loadTranslations('zh-Hant');
        const language = vi.spyOn(languageContext, 'useLanguage').mockReturnValue({
            language: 'zh-Hant', setLanguage: vi.fn(), t: (key) => translations[key] ?? key,
        });
        try {
            renderPanel();
            expect(screen.getByText('專注')).toBeInTheDocument();
            fireEvent.click(screen.getByRole('button', { name: '切換到休息' }));
            expect(screen.getByText('休息')).toBeInTheDocument();
            fireEvent.click(screen.getByRole('button', { name: '收起計時器' }));
            expect(screen.getByText('休息')).toBeInTheDocument();
            fireEvent.click(screen.getByRole('button', { name: '展開計時器' }));
            fireEvent.click(screen.getByRole('button', { name: '切換到專注' }));
            expect(screen.getByText('專注')).toBeInTheDocument();
        } finally {
            language.mockRestore();
        }
    });

    it('restores device-local timer state and task history from local storage', () => {
        window.localStorage.setItem(DESKTOP_POMODORO_SESSION_STORAGE_KEY, JSON.stringify({
            durations: { focusMinutes: 25, breakMinutes: 5 },
            timerState: {
                phase: 'focus',
                remainingSeconds: 1200,
                isRunning: false,
                completedFocusSessions: 0,
            },
            selectedTaskId: 'task-1',
            updatedAtMs: Date.now(),
            sessionHistory: {
                totalCompletedFocusSessions: 4,
                completedFocusSessionsByTaskId: {
                    'task-1': 2,
                },


                todayDayKey: getPomodoroLocalDayKey(),
                completedTodayFocusSessions: 4,
            },
        }));

        const { getByLabelText, getByText } = renderPanel();

        // Tiny dots plus a screen-reader count, no visible sentence.
        expect(getByText('Focus sessions completed: 4')).toHaveClass('sr-only');
        expect(getByLabelText('Timer task').textContent).toContain('Write RFC reply');
    });

    it('persists timer state changes to device-local storage', () => {
        const { getByRole } = renderPanel();

        fireEvent.click(getByRole('button', { name: 'Start' }));

        const stored = JSON.parse(window.localStorage.getItem(DESKTOP_POMODORO_SESSION_STORAGE_KEY) ?? '{}');
        expect(stored.timerState).toMatchObject({
            phase: 'focus',
            isRunning: true,
            completedFocusSessions: 0,
        });
        expect(stored.sessionHistory).toEqual({
            totalCompletedFocusSessions: 0,
            completedFocusSessionsByTaskId: {},
            todayDayKey: getPomodoroLocalDayKey(),
            completedTodayFocusSessions: 0,
        });
    });

    it('shows zero completed sessions once the stored day has passed', () => {
        window.localStorage.setItem(DESKTOP_POMODORO_SESSION_STORAGE_KEY, JSON.stringify({
            durations: { focusMinutes: 25, breakMinutes: 5 },
            timerState: {
                phase: 'focus',
                remainingSeconds: 1200,
                isRunning: false,
                completedFocusSessions: 4,
            },
            selectedTaskId: 'task-1',
            updatedAtMs: Date.now(),
            sessionHistory: {
                totalCompletedFocusSessions: 4,
                completedFocusSessionsByTaskId: { 'task-1': 2 },
                todayDayKey: '2001-01-01',
                completedTodayFocusSessions: 4,
            },
        }));

        renderPanel();

        expect(screen.queryByTestId('pomodoro-sessions')).toBeNull();
    });

    it('links a task through the searchable popup and clears back to timer only', () => {
        const otherTask: Task = { ...task, id: 'task-2', title: 'Draft release notes' };
        useTaskStore.setState({ tasks: [task, otherTask], _allTasks: [task, otherTask] } as never);
        render(
            <LanguageProvider>
                <PomodoroPanel tasks={[task, otherTask]} />
            </LanguageProvider>
        );


        expect(screen.getByLabelText('Timer task').textContent).toContain('Choose a task');


        fireEvent.click(screen.getByLabelText('Timer task'));
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'release' } });
        expect(screen.queryByRole('option', { name: 'Write RFC reply' })).toBeNull();
        fireEvent.click(screen.getByRole('option', { name: 'Draft release notes' }));

        expect(screen.getByLabelText('Timer task').textContent).toContain('Draft release notes');
        let stored = JSON.parse(window.localStorage.getItem(DESKTOP_POMODORO_SESSION_STORAGE_KEY) ?? '{}');
        expect(stored.selectedTaskId).toBe('task-2');


        fireEvent.click(screen.getByLabelText('Timer task'));
        fireEvent.click(screen.getByRole('option', { name: 'Timer only' }));

        expect(screen.getByLabelText('Timer task').textContent).toContain('Choose a task');
        stored = JSON.parse(window.localStorage.getItem(DESKTOP_POMODORO_SESSION_STORAGE_KEY) ?? '{}');
        expect(stored.selectedTaskId ?? null).toBeNull();
    });

    const storeSession = (selectedTaskId: string) => window.localStorage.setItem(
        DESKTOP_POMODORO_SESSION_STORAGE_KEY,
        JSON.stringify({
            durations: { focusMinutes: 25, breakMinutes: 5 },
            timerState: { phase: 'focus', remainingSeconds: 1500, isRunning: false, completedFocusSessions: 0 },
            selectedTaskId,
            updatedAtMs: Date.now(),
            sessionHistory: { totalCompletedFocusSessions: 0, completedFocusSessionsByTaskId: {} },
        })
    );


    it('keeps a linked task that is not in the panel list', () => {
        const offFocusTask: Task = { ...task, id: 'task-3', title: 'Deferred chore' };
        useTaskStore.setState({ tasks: [task, offFocusTask], _allTasks: [task, offFocusTask] } as never);
        storeSession('task-3');

        render(
            <LanguageProvider>
                <PomodoroPanel tasks={[task]} />
            </LanguageProvider>
        );

        expect(screen.getByLabelText('Timer task').textContent).toContain('Deferred chore');
        const stored = JSON.parse(window.localStorage.getItem(DESKTOP_POMODORO_SESSION_STORAGE_KEY) ?? '{}');
        expect(stored.selectedTaskId).toBe('task-3');
    });


    it('still clears the link when the linked task no longer exists', () => {
        useTaskStore.setState({ tasks: [task], _allTasks: [task] } as never);
        storeSession('deleted-task');

        render(
            <LanguageProvider>
                <PomodoroPanel tasks={[task]} />
            </LanguageProvider>
        );

        expect(screen.getByLabelText('Timer task').textContent).toContain('Choose a task');
    });

    it.each(['done', 'archived', 'cancelled', 'reference', 'deleted'] as const)(
        'unlinks a task becoming %s while the picker is open without changing the timer', (transition) => {
            storeSession(task.id);
            renderPanel();
            fireEvent.click(screen.getByRole('button', { name: 'Start' }));
            fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
            fireEvent.click(screen.getByLabelText('Timer task'));
            expect(screen.getByRole('option', { name: task.title })).toBeInTheDocument();
            const before = usePomodoroStore.getState().snapshot;

            const nextTasks: Task[] = transition === 'deleted' ? [] : [{
                ...task,
                status: transition === 'cancelled' ? 'archived' : transition,
                ...(transition === 'cancelled' ? { cancelledAt: nowIso } : {}),
            }];
            act(() => useTaskStore.setState({ tasks: nextTasks, _allTasks: nextTasks }));

            expect(screen.getByRole('button', { name: 'Timer task' }).textContent).toContain('Choose a task');
            expect(screen.getByRole('option', { name: 'Timer only' })).toHaveAttribute('aria-selected', 'true');
            expect(screen.queryByRole('option', { name: task.title })).toBeNull();
            expect(screen.queryByLabelText('Mark task done')).toBeNull();
            // Only the link changes; with no open task linked, the phase may no longer run into overtime.
            const { keepGoing: _keepGoing, ...timerWithoutKeepGoing } = before.timerState;
            expect(before.timerState.keepGoing).toBe(true);
            expect(usePomodoroStore.getState().snapshot).toEqual({ ...before, selectedTaskId: undefined, timerState: timerWithoutKeepGoing });
        }
    );

    it('uses current live titles and eligibility for unselected picker candidates', () => {
        const otherTask: Task = { ...task, id: 'task-2', title: 'Keep working' };
        useTaskStore.setState({ tasks: [task, otherTask], _allTasks: [task, otherTask] });
        render(<LanguageProvider><PomodoroPanel tasks={[task, otherTask]} /></LanguageProvider>);
        fireEvent.click(screen.getByLabelText('Timer task'));

        const nextTasks: Task[] = [{ ...task, status: 'done' }, { ...otherTask, title: 'Updated title' }];
        act(() => useTaskStore.setState({ tasks: nextTasks, _allTasks: nextTasks }));

        expect(screen.queryByRole('option', { name: task.title })).toBeNull();
        expect(screen.queryByRole('option', { name: otherTask.title })).toBeNull();
        fireEvent.click(screen.getByRole('option', { name: 'Updated title' }));
        expect(screen.getByLabelText('Timer task').textContent).toContain('Updated title');
    });

    it('keeps the link until its own Mark done changes the live task', async () => {
        let finish!: () => void;
        const updateTask = vi.fn(() => new Promise<{ success: true }>((resolve) => {
            finish = () => {
                const completed: Task = { ...task, status: 'done' };
                useTaskStore.setState({ tasks: [completed], _allTasks: [completed] });
                resolve({ success: true });
            };
        }));
        useTaskStore.setState({ updateTask });
        storeSession(task.id);
        renderPanel();

        fireEvent.click(screen.getByLabelText('Mark task done'));
        expect(usePomodoroStore.getState().snapshot.selectedTaskId).toBe(task.id);
        await act(async () => finish());

        expect(screen.getByLabelText('Timer task').textContent).toContain('Choose a task');
        fireEvent.click(screen.getByLabelText('Timer task'));
        expect(screen.queryByRole('option', { name: task.title })).toBeNull();
    });


    it('reports a failed Mark done instead of silently doing nothing', async () => {
        const updateTask = vi.fn().mockResolvedValue({ success: false, error: 'Disk full' });
        useUiStore.setState({ toasts: [] });
        useTaskStore.setState({ tasks: [task], _allTasks: [task], updateTask } as never);
        storeSession('task-1');

        render(
            <LanguageProvider>
                <PomodoroPanel tasks={[task]} />
            </LanguageProvider>
        );

        await act(async () => {
            fireEvent.click(screen.getByLabelText('Mark task done'));
        });

        expect(updateTask).toHaveBeenCalledWith('task-1', { status: 'done', isFocusedToday: false });
        expect(useUiStore.getState().toasts.map((toast) => toast.message)).toContain('Disk full');
        expect(usePomodoroStore.getState().snapshot.selectedTaskId).toBe(task.id);
        expect(screen.getByLabelText('Timer task').textContent).toContain(task.title);
    });

    it('idle card is minimal: ring, clock, one task line and a Start button', () => {
        renderPanel();
        expect(screen.getByTestId('pomodoro-ring')).toHaveAttribute('data-phase', 'focus');
        expect(screen.getByTestId('pomodoro-clock').textContent).toBe('25:00');
        // No visible preset control, prompt, quick picks, motivation or hint.
        expect(screen.queryByRole('radiogroup')).toBeNull();
        expect(screen.queryByText('What will you focus on?')).toBeNull();
        expect(screen.queryByText(/Pick a task for a guided/)).toBeNull();
        expect(screen.queryByText(/calm break/)).toBeNull();
        expect(screen.queryByText(/Everything else will dim/)).toBeNull();
        expect(screen.queryByRole('button', { name: 'Reset' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Switch to Break' })).toBeInTheDocument();
        expect(screen.getByLabelText('Timer task').textContent).toBe('Choose a task');
        expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
    });

    it('chooses a preset from a popover opened by tapping the clock', () => {
        renderPanel();
        const clock = screen.getByRole('button', { name: 'Session length' });
        fireEvent.click(clock);
        expect(screen.getByRole('radio', { name: /Classic\s*25\/5/ })).toHaveAttribute('aria-checked', 'true');
        fireEvent.click(screen.getByRole('radio', { name: /Deep/ }));
        expect(screen.queryByRole('radiogroup')).toBeNull();
        expect(screen.getByTestId('pomodoro-clock').textContent).toBe('50:00');
    });

    it('shows the session length under the time ("25 min ⌄"), which opens the presets with a one-line explainer', () => {
        renderPanel();
        const label = screen.getByTestId('pomodoro-preset-label');
        expect(label).toHaveTextContent('25 min');
        fireEvent.click(label);
        expect(screen.getByTestId('pomodoro-preset-hint')).toHaveTextContent('Focus minutes / break minutes');
        expect(screen.getByRole('radio', { name: /Classic\s*25\/5/ })).toHaveAttribute('aria-checked', 'true');
        // A second click on the same label closes it (it is not an "outside" click).
        fireEvent.mouseDown(label);
        fireEvent.click(label);
        expect(screen.queryByRole('radiogroup')).toBeNull();
        fireEvent.click(label);
        fireEvent.click(screen.getByRole('radio', { name: /Quick/ }));
        expect(screen.getByTestId('pomodoro-clock').textContent).toBe('15:00');
        expect(screen.getByTestId('pomodoro-preset-label')).toHaveTextContent('15 min');
    });

    it('overtime on the Today card: "+M:SS" in a calmer tone, a faint second lap, "Over time"', () => {
        storeSession(task.id);
        renderPanel();
        act(() => {
            usePomodoroStore.getState().commitPomodoro((prev) => ({
                ...prev,
                timerState: { ...prev.timerState, isRunning: true, remainingSeconds: 0, overtimeSeconds: 300, keepGoing: true },
                updatedAtMs: Date.now(),
            }));
        });
        expect(screen.getByTestId('pomodoro-clock')).toHaveTextContent('+5:00');
        expect(screen.getByTestId('pomodoro-clock')).toHaveAttribute('data-overtime', 'true');
        expect(screen.getByTestId('pomodoro-overtime')).toHaveTextContent('Over time');
        expect(screen.getByTestId('pomodoro-ring-overtime')).toBeInTheDocument();
    });

    it('when running hides everything but the ring, task title and a pause button', () => {
        storeSession(task.id);
        renderPanel();
        fireEvent.click(screen.getByRole('button', { name: 'Start' }));
        expect(screen.getByTestId('pomodoro-ring')).toHaveAttribute('data-running', 'true');
        expect(screen.queryByRole('button', { name: 'Start' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Session length' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Switch to Break' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Collapse timer' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
        const visibleTitle = screen.getAllByText(task.title).filter((node) => !node.closest('[aria-hidden="true"]'));
        expect(visibleTitle).toHaveLength(1);
    });

    it('shows Reset only once a phase is under way and paused', () => {
        window.localStorage.setItem(DESKTOP_POMODORO_SESSION_STORAGE_KEY, JSON.stringify({
            durations: { focusMinutes: 25, breakMinutes: 5 },
            timerState: { phase: 'focus', remainingSeconds: 1200, isRunning: false, completedFocusSessions: 0 },
            updatedAtMs: Date.now(),
            sessionHistory: { totalCompletedFocusSessions: 0, completedFocusSessionsByTaskId: {} },
        }));
        renderPanel();
        fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
        expect(screen.getByTestId('pomodoro-clock').textContent).toBe('25:00');
        expect(screen.queryByRole('button', { name: 'Reset' })).toBeNull();
    });

    it('switches to a quiet break from the ring phase label', () => {
        renderPanel();
        fireEvent.click(screen.getByRole('button', { name: 'Switch to Break' }));
        expect(screen.getByTestId('pomodoro-ring')).toHaveAttribute('data-phase', 'break');
        expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Switch to Focus' }).textContent).toBe('Break');
    });
    it('offers Back to focus while a task session is minimised or hidden, and records where the stage grows from', () => {
        resetFocusSessionStore();
        storeSession(task.id);
        renderPanel();
        const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 10, y: 20, left: 10, top: 20, width: 300, height: 200, right: 310, bottom: 220, toJSON: () => ({}) });
        fireEvent.click(screen.getByRole('button', { name: 'Start' }));
        rect.mockRestore();
        expect(useFocusSessionStore.getState().origin).toEqual({ x: 10, y: 20, width: 300, height: 200 });
        expect(screen.queryByTestId('pomodoro-back-to-focus')).toBeNull();
        act(() => { useFocusSessionStore.getState().open_(0); useFocusSessionStore.getState().minimise(); });
        fireEvent.click(screen.getByRole('button', { name: 'Back to focus' }));
        expect(useFocusSessionStore.getState().presentation).toBe('full');
        expect(screen.queryByTestId('pomodoro-back-to-focus')).toBeNull();
        resetFocusSessionStore();
    });
});
