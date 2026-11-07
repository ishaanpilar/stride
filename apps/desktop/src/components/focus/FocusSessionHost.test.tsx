import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createPomodoroState, DEFAULT_POMODORO_DURATIONS, getPomodoroLocalDayKey, useTaskStore, type Task } from '@stride/core';
import { LanguageProvider } from '../../contexts/language-context';
import { usePomodoroStore, type PomodoroSnapshot } from '../../store/pomodoro-store';
import { FOCUS_PRESENTATION_STORAGE_KEY, resetFocusSessionStore, useFocusSessionStore } from '../../store/focus-session-store';
import { resetFocusAiCacheForTests } from '../../lib/focus-ai-service';
import { FocusSessionHost } from './FocusSessionHost';
import { useFocusShell } from './useFocusShell';

const fullscreen = vi.hoisted(() => ({ on: false }));
vi.mock('../../lib/window-fullscreen', () => ({
    isWindowFullscreen: vi.fn(async () => fullscreen.on),
    setWindowFullscreen: vi.fn(async (on: boolean) => { fullscreen.on = on; return on; }),
}));

const ai = vi.hoisted(() => ({ coach: null as string | null, reply: null as string | null }));
vi.mock('../../lib/focus-ai-service', async () => {
    const core = await vi.importActual<typeof import('@stride/core')>('@stride/core');
    const provider = (text: string | null) => (text === null ? null : { generateText: async () => text });
    return {
        isFocusAiEnabled: () => ai.coach !== null,
        requestFocusCoach: vi.fn(async (_key: string, input: never, options: { tr?: never; seed?: number }) => core.generateFocusCoach(provider(ai.coach), input, options)),
        requestFocusCoachReply: vi.fn(async (input: never, turns: never, options: { tr?: never }) => core.generateFocusCoachReply(provider(ai.reply), input, turns, { now: new Date(), tr: options?.tr })),
        requestFocusEncouragement: vi.fn(async () => null),
        resetFocusAiCacheForTests: () => undefined,
    };
});

const iso = '2026-07-01T12:00:00.000Z';
const makeTask = (checklist: Task['checklist']): Task => ({
    id: 't1', title: 'Write the report', status: 'next', tags: [], contexts: [], createdAt: iso, updatedAt: iso, checklist,
});
const steps = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, title: `Step ${i}`, isCompleted: false }));

const Shell = () => {
    const shell = useFocusShell();
    return <div data-testid="shell" data-focus-session={shell.mode} inert={shell.inert || undefined} />;
};

const setSnapshot = (patch: Partial<PomodoroSnapshot> & { running?: boolean }) => {
    const { running, ...rest } = patch;
    const base = usePomodoroStore.getState().snapshot;
    usePomodoroStore.setState({
        hasHydrated: true,
        snapshot: {
            ...base,
            selectedTaskId: 't1',
            timerState: { ...createPomodoroState(DEFAULT_POMODORO_DURATIONS), isRunning: running ?? true },
            ...rest,
        },
    });
};

const renderHost = () => render(<LanguageProvider><Shell /><FocusSessionHost /></LanguageProvider>);
const stage = () => screen.getByRole('dialog', { name: 'Focus session' });
const running = () => usePomodoroStore.getState().snapshot.timerState.isRunning;

describe('FocusSessionHost', () => {
    beforeEach(() => {
        localStorage.clear();
        resetFocusSessionStore();
        usePomodoroStore.setState({ snapshot: { ...usePomodoroStore.getState().snapshot, lastEvent: null, selectedTaskId: undefined, timerState: createPomodoroState(DEFAULT_POMODORO_DURATIONS) } });
        resetFocusAiCacheForTests();
        ai.coach = null;
        ai.reply = null;
        const task = makeTask(steps(4));
        useTaskStore.setState({
            tasks: [task], _allTasks: [task], projects: [],
            settings: {},
            updateTask: vi.fn(async (id: string, updates: Partial<Task>) => {
                useTaskStore.setState((state) => ({
                    _allTasks: state._allTasks.map((t) => (t.id === id ? { ...t, ...updates } : t)),
                }));
                return { success: true };
            }) as never,
            addTask: vi.fn(async (title: string, props: Partial<Task>) => {
                const created = { ...makeTask(undefined), ...props, id: `new-${title}`, title };
                useTaskStore.setState((state) => ({ _allTasks: [...state._allTasks, created] }));
                return { success: true, id: created.id };
            }) as never,
            deleteTask: vi.fn(async (id: string) => {
                useTaskStore.setState((state) => ({ _allTasks: state._allTasks.filter((t) => t.id !== id) }));
                return { success: true };
            }) as never,
        });
    });

    it('opens the full stage for a running task: the app behind is dimmed and inert', () => {
        renderHost();
        expect(screen.getByTestId('shell')).not.toHaveAttribute('data-focus-session');
        act(() => setSnapshot({}));
        expect(screen.getByTestId('shell')).toHaveAttribute('data-focus-session', 'focus');
        expect(screen.getByTestId('shell')).toHaveAttribute('inert');
        expect(stage()).toHaveTextContent('25:00');
        expect(stage()).toHaveTextContent('Write the report');
    });

    it('Start with no task still opens the full stage: a quiet "Timer only" line and a task picker', async () => {
        renderHost();
        act(() => setSnapshot({ selectedTaskId: undefined }));
        expect(screen.getByTestId('shell')).toHaveAttribute('data-focus-session', 'focus');
        expect(stage()).toHaveTextContent('25:00');
        expect(screen.getByTestId('focus-timer-only')).toHaveTextContent('Timer only');
        fireEvent.click(within(stage()).getByRole('button', { name: 'Timer task' }));
        await act(async () => { fireEvent.click(screen.getByRole('option', { name: 'Write the report' })); });
        expect(usePomodoroStore.getState().snapshot.selectedTaskId).toBe('t1');
        expect(running()).toBe(true);
        // The same stage now shows the task and its own checklist, compact: just the current step.
        expect(screen.queryByTestId('focus-timer-only')).toBeNull();
        expect(screen.getAllByRole('checkbox')).toHaveLength(1);
        expect(screen.getByRole('button', { name: 'Show all 4 steps' })).toBeInTheDocument();
        // Attaching a task is not a tick: no "Next" line, no announcement.
        expect(screen.getByTestId('focus-note')).toHaveTextContent('');
        expect(screen.getByTestId('focus-live')).toHaveTextContent('');
    });

    it('Start in the Break phase opens the teal break stage, with or without a task', () => {
        renderHost();
        act(() => setSnapshot({ selectedTaskId: undefined, timerState: { ...createPomodoroState(DEFAULT_POMODORO_DURATIONS), phase: 'break', remainingSeconds: 300, isRunning: true } }));
        expect(screen.getByTestId('shell')).toHaveAttribute('data-focus-session', 'break');
        expect(screen.getByTestId('focus-ambient')).toHaveAttribute('data-kind', 'break');
        expect(stage()).toHaveTextContent('05:00');
        expect(screen.getByTestId('focus-sub')).toHaveTextContent('Break');
    });

    it('toggles true full screen; Esc leaves full screen before it minimises', async () => {
        fullscreen.on = false;
        renderHost();
        act(() => setSnapshot({}));
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enter full screen' })); });
        expect(fullscreen.on).toBe(true);
        expect(screen.getByRole('button', { name: 'Exit full screen' })).toHaveAttribute('aria-pressed', 'true');
        await act(async () => { fireEvent.keyDown(window, { key: 'Escape' }); });
        expect(fullscreen.on).toBe(false);
        expect(stage()).toBeInTheDocument();
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(screen.getByTestId('focus-mini')).toBeInTheDocument();
    });

    it('Minimise floats a mini card over the normal app; the timer keeps running; expand returns', () => {
        renderHost();
        act(() => setSnapshot({}));
        fireEvent.click(screen.getByRole('button', { name: 'Minimise' }));
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.getByTestId('shell')).not.toHaveAttribute('data-focus-session');
        expect(screen.getByTestId('shell')).not.toHaveAttribute('inert');
        expect(running()).toBe(true);
        const mini = screen.getByTestId('focus-mini');
        expect(mini).toHaveTextContent('25:00');
        expect(mini).toHaveTextContent('Write the report');
        expect(within(mini).getByRole('checkbox', { name: 'Step 0' })).toBeInTheDocument();
        expect(localStorage.getItem(FOCUS_PRESENTATION_STORAGE_KEY)).toBe('mini');
        // Pause from the mini card.
        fireEvent.click(within(mini).getByRole('button', { name: 'Pause' }));
        expect(running()).toBe(false);
        expect(mini).toHaveTextContent('Paused');
        fireEvent.click(within(mini).getByRole('button', { name: 'Start' }));
        fireEvent.click(within(mini).getByRole('button', { name: 'Back to focus' }));
        expect(stage()).toBeInTheDocument();
        expect(screen.queryByTestId('focus-mini')).toBeNull();
        expect(screen.getByTestId('shell')).toHaveAttribute('data-focus-session', 'focus');
    });

    it('ticks the current step from the mini card', async () => {
        renderHost();
        act(() => setSnapshot({}));
        fireEvent.click(screen.getByRole('button', { name: 'Minimise' }));
        await act(async () => { fireEvent.click(screen.getByRole('checkbox', { name: 'Step 0' })); });
        expect(useTaskStore.getState()._allTasks[0]!.checklist![0]!.isCompleted).toBe(true);
        expect(screen.getByRole('checkbox', { name: 'Step 1' })).toBeInTheDocument();
    });

    it('Esc minimises a running session', () => {
        renderHost();
        act(() => setSnapshot({}));
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.getByTestId('focus-mini')).toBeInTheDocument();
        expect(running()).toBe(true);
        // Keyboard focus lands on the mini card, not on the page body.
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Back to focus' }));
    });

    it('Close (X) hides the stage: only a pill stays in the corner while the timer runs', () => {
        renderHost();
        act(() => setSnapshot({}));
        fireEvent.click(screen.getByRole('button', { name: 'Hide, keep timer running' }));
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.queryByTestId('focus-mini')).toBeNull();
        expect(screen.getByTestId('shell')).not.toHaveAttribute('inert');
        expect(running()).toBe(true);
        const pill = screen.getByTestId('focus-pill');
        expect(pill).toHaveAccessibleName('Back to focus, 25:00');
        fireEvent.click(pill);
        expect(stage()).toBeInTheDocument();
    });

    it('the mini card close button hides to the pill', () => {
        renderHost();
        act(() => setSnapshot({}));
        fireEvent.keyDown(window, { key: 'Escape' });
        fireEvent.click(within(screen.getByTestId('focus-mini')).getByRole('button', { name: 'Hide, keep timer running' }));
        expect(screen.getByTestId('focus-pill')).toBeInTheDocument();
        expect(useFocusSessionStore.getState().presentation).toBe('hidden');
    });

    it('ending a running session asks first; Stay focused keeps it, End session stops the timer', () => {
        renderHost();
        act(() => setSnapshot({}));
        fireEvent.click(screen.getByRole('button', { name: 'End session' }));
        expect(stage()).toHaveTextContent('Leave focus?');
        fireEvent.click(screen.getByRole('button', { name: 'Stay focused' }));
        expect(stage()).not.toHaveTextContent('Leave focus?');
        expect(running()).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: 'End session' }));
        fireEvent.click(within(screen.getByRole('group', { name: 'Leave focus?' })).getByRole('button', { name: 'End session' }));
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(running()).toBe(false);
    });

    it('ends at once when the timer is paused', () => {
        renderHost();
        act(() => setSnapshot({}));
        act(() => setSnapshot({ running: false }));
        expect(stage()).toHaveTextContent('Paused');
        fireEvent.click(screen.getByRole('button', { name: 'End session' }));
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('shows the checklist compact (current step only); ticking saves it and says what is next', async () => {
        renderHost();
        act(() => setSnapshot({}));
        expect(screen.getAllByRole('checkbox').map((c) => c.getAttribute('aria-label'))).toEqual(['Step 0']);
        expect(screen.getByTestId('focus-count')).toHaveTextContent('Step 1 of 4');
        await act(async () => { fireEvent.click(screen.getByRole('checkbox', { name: 'Step 0' })); });
        expect(useTaskStore.getState()._allTasks[0]!.checklist![0]!.isCompleted).toBe(true);
        expect(screen.getByTestId('focus-count')).toHaveTextContent('Step 2 of 4');
        expect(screen.getByRole('checkbox', { name: 'Step 1' })).toBeInTheDocument();
        expect(screen.getByTestId('focus-live')).toHaveTextContent('Step 1 of 4 done');
        expect(screen.getByTestId('focus-note')).toHaveTextContent('Next: Step 1');
        expect(screen.getByTestId('focus-note')).toHaveTextContent('Nice start');
        fireEvent.click(screen.getByRole('button', { name: 'Show all 4 steps' }));
        expect(screen.getAllByRole('checkbox')).toHaveLength(4);
    });

    it('finishing every step asks "Is it done?"; Done marks the task done with an Undo', async () => {
        const task = makeTask(steps(1));
        useTaskStore.setState({ tasks: [task], _allTasks: [task] });
        renderHost();
        act(() => setSnapshot({}));
        await act(async () => { fireEvent.click(screen.getByRole('checkbox', { name: 'Step 0' })); });
        const checkIn = screen.getByTestId('focus-checkin');
        expect(within(checkIn).getByRole('heading', { name: 'Is it done?' })).toBeInTheDocument();
        expect(within(within(checkIn).getByRole('group', { name: 'Is it done?' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['Done', 'Almost', 'Not yet']);
        expect(screen.getByRole('button', { name: 'Minimise' })).toBeInTheDocument();
        await act(async () => { fireEvent.click(within(checkIn).getByRole('button', { name: 'Done' })); });
        expect(useTaskStore.getState()._allTasks[0]!.status).toBe('done');
        expect(running()).toBe(false);
        expect(within(checkIn).getByRole('heading', { name: 'Done. Nicely handled.' })).toBeInTheDocument();
        await act(async () => { fireEvent.click(within(checkIn).getByRole('button', { name: 'Undo' })); });
        expect(useTaskStore.getState()._allTasks[0]!.status).toBe('next');
        expect(within(checkIn).getByRole('heading', { name: 'Is it done?' })).toBeInTheDocument();
        await act(async () => { fireEvent.click(within(checkIn).getByRole('button', { name: 'Done' })); });
        fireEvent.click(within(checkIn).getByRole('button', { name: 'Close' }));
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(usePomodoroStore.getState().snapshot.selectedTaskId).toBeUndefined();
    });

    it('the session check-in: small readable stats; Almost sets what is left (undoable) and offers another session', async () => {
        renderHost();
        act(() => setSnapshot({}));
        act(() => setSnapshot({
            lastEvent: 'focus-finished',
            running: false,
            sessionHistory: { totalCompletedFocusSessions: 3, completedFocusSessionsByTaskId: { t1: 3 }, todayDayKey: getPomodoroLocalDayKey(), completedTodayFocusSessions: 3 },
        }));
        const checkIn = screen.getByTestId('focus-checkin');
        expect(screen.getByTestId('focus-checkin-stats')).toHaveTextContent('25 min focused · 3 sessions today');
        expect(JSON.parse(localStorage.getItem('stride:focus-streak:v1')!)).toHaveLength(1);
        expect(screen.queryByRole('button', { name: 'Minimise' })).toBeNull();
        fireEvent.click(within(checkIn).getByRole('button', { name: 'Almost' }));
        expect(within(checkIn).getByRole('heading', { name: 'How much is left?' })).toBeInTheDocument();
        // Planning the rest (estimate / schedule) is the secondary path.
        fireEvent.click(screen.getByTestId('focus-checkin-plan'));
        fireEvent.click(within(checkIn).getByRole('button', { name: '~25 min' }));
        expect(within(checkIn).getByRole('heading', { name: 'About 25 min to go' })).toBeInTheDocument();
        // Nothing changes until the user confirms.
        expect(useTaskStore.getState()._allTasks[0]!.timeEstimate).toBeUndefined();
        await act(async () => { fireEvent.click(screen.getByTestId('focus-checkin-estimate')); });
        expect(useTaskStore.getState()._allTasks[0]!.timeEstimate).toBe('custom:25');
        await act(async () => { fireEvent.click(within(screen.getByTestId('focus-checkin-estimate-done')).getByRole('button', { name: 'Undo' })); });
        expect(useTaskStore.getState()._allTasks[0]!.timeEstimate).toBeUndefined();
        await act(async () => { fireEvent.click(screen.getByTestId('focus-checkin-schedule')); });
        expect(useTaskStore.getState()._allTasks[0]!.startTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:00:00$/);
        fireEvent.click(within(checkIn).getByRole('button', { name: 'Start another session' }));
        expect(running()).toBe(true);
        expect(screen.queryByTestId('focus-checkin')).toBeNull();
    });

    it('Almost → "~10 min" extends the same session on the same task and returns to the running stage', () => {
        renderHost();
        act(() => setSnapshot({}));
        act(() => setSnapshot({
            lastEvent: 'focus-finished',
            running: false,
            timerState: { ...createPomodoroState(DEFAULT_POMODORO_DURATIONS, 'break'), isRunning: false },
        }));
        fireEvent.click(within(screen.getByTestId('focus-checkin')).getByRole('button', { name: 'Almost' }));
        fireEvent.click(screen.getByTestId('focus-checkin-keep-10'));
        const snapshot = usePomodoroStore.getState().snapshot;
        expect(snapshot.selectedTaskId).toBe('t1');
        expect(snapshot.lastEvent).toBeNull();
        expect(snapshot.timerState).toMatchObject({ phase: 'focus', isRunning: true, remainingSeconds: 600, phaseTotalSeconds: 600 });
        expect(screen.queryByTestId('focus-checkin')).toBeNull();
        expect(screen.getByRole('timer')).toHaveAccessibleName('10:00 remaining');
        // Nothing was estimated or scheduled on the way.
        expect(useTaskStore.getState()._allTasks[0]!.timeEstimate).toBeUndefined();
    });

    it('Almost → "Another session" starts a fresh focus phase on the same task', () => {
        renderHost();
        act(() => setSnapshot({}));
        act(() => setSnapshot({ lastEvent: 'focus-finished', running: false, timerState: { ...createPomodoroState(DEFAULT_POMODORO_DURATIONS, 'break'), isRunning: false } }));
        fireEvent.click(within(screen.getByTestId('focus-checkin')).getByRole('button', { name: 'Almost' }));
        fireEvent.click(screen.getByTestId('focus-checkin-keep-session'));
        expect(usePomodoroStore.getState().snapshot.timerState).toMatchObject({ phase: 'focus', isRunning: true, remainingSeconds: 1500 });
        expect(usePomodoroStore.getState().snapshot.selectedTaskId).toBe('t1');
    });

    it('overtime: the stage counts up in a calmer tone; Pause ends it with the check-in', () => {
        renderHost();
        act(() => setSnapshot({ timerState: { ...createPomodoroState(DEFAULT_POMODORO_DURATIONS), isRunning: true, remainingSeconds: 0, overtimeSeconds: 75, keepGoing: true } }));
        const clock = screen.getByRole('timer');
        expect(clock).toHaveAccessibleName('1:15 over time');
        expect(clock).toHaveAttribute('data-overtime', 'true');
        expect(stage()).toHaveAttribute('data-overtime', 'true');
        expect(screen.getByTestId('focus-sub')).toHaveTextContent('Over time');
        fireEvent.click(within(stage()).getByRole('button', { name: 'Pause and check in' }));
        const snapshot = usePomodoroStore.getState().snapshot;
        expect(snapshot.lastEvent).toBe('focus-finished');
        expect(snapshot.timerState.lastFocusSeconds).toBe(1500 + 75);
        expect(screen.getByTestId('focus-checkin')).toBeInTheDocument();
        expect(screen.getByTestId('focus-checkin-stats')).toHaveTextContent('26 min focused');
    });

    it('overtime: the minimised card and pill show the count-up too', () => {
        renderHost();
        act(() => setSnapshot({ timerState: { ...createPomodoroState(DEFAULT_POMODORO_DURATIONS), isRunning: true, remainingSeconds: 0, overtimeSeconds: 125, keepGoing: true } }));
        fireEvent.click(screen.getByRole('button', { name: 'Minimise' }));
        const mini = screen.getByTestId('focus-mini');
        expect(mini).toHaveAttribute('data-overtime', 'true');
        expect(within(mini).getByRole('timer')).toHaveTextContent('+2:05');
        expect(mini).toHaveTextContent('Over time');
    });

    it('a task ticked done during overtime opens the check-in on "Done"', () => {
        renderHost();
        act(() => setSnapshot({ timerState: { ...createPomodoroState(DEFAULT_POMODORO_DURATIONS), isRunning: true, remainingSeconds: 0, overtimeSeconds: 30, keepGoing: true } }));
        act(() => {
            const done = { ...useTaskStore.getState()._allTasks[0]!, status: 'done' as const };
            useTaskStore.setState({ tasks: [done], _allTasks: [done] } as never);
            usePomodoroStore.getState().commitPomodoro((prev) => prev);
        });
        expect(usePomodoroStore.getState().snapshot.lastEvent).toBe('focus-finished');
        expect(screen.getByTestId('focus-checkin')).toHaveAttribute('data-stage', 'done');
    });

    it('Not yet > Waiting on someone moves the task to Waiting For (confirmed, undoable)', async () => {
        renderHost();
        act(() => setSnapshot({}));
        act(() => setSnapshot({ lastEvent: 'focus-finished', running: false }));
        const checkIn = screen.getByTestId('focus-checkin');
        fireEvent.click(within(checkIn).getByRole('button', { name: 'Not yet' }));
        expect(within(checkIn).getByRole('heading', { name: "What's in the way?" })).toBeInTheDocument();
        fireEvent.click(within(checkIn).getByRole('button', { name: 'Waiting on someone' }));
        fireEvent.change(within(checkIn).getByRole('textbox', { name: 'Who are you waiting on?' }), { target: { value: 'Yaman' } });
        await act(async () => { fireEvent.click(screen.getByTestId('focus-checkin-waiting')); });
        expect(useTaskStore.getState()._allTasks[0]).toMatchObject({ status: 'waiting', assignedTo: 'Yaman' });
        await act(async () => { fireEvent.click(within(screen.getByTestId('focus-checkin-waiting-done')).getByRole('button', { name: 'Undo' })); });
        expect(useTaskStore.getState()._allTasks[0]!.status).toBe('next');
        expect(useTaskStore.getState()._allTasks[0]!.assignedTo).toBeUndefined();
    });

    it('Not yet > Need info offers a follow-up task and a reschedule; a typed reason gets a coach reply', async () => {
        ai.coach = '{}';
        ai.reply = JSON.stringify({ reply: 'Then ask Yaman for the forms first.', actions: [{ type: 'add_followup_task', title: 'Ask Yaman for the forms' }] });
        renderHost();
        act(() => setSnapshot({}));
        act(() => setSnapshot({ lastEvent: 'focus-finished', running: false }));
        const checkIn = screen.getByTestId('focus-checkin');
        fireEvent.click(within(checkIn).getByRole('button', { name: 'Not yet' }));
        const reason = within(checkIn).getByRole('textbox', { name: "Or say what's blocking" });
        fireEvent.change(reason, { target: { value: 'I need the forms from Yaman' } });
        await act(async () => { fireEvent.keyDown(reason, { key: 'Enter' }); });
        expect(screen.getByTestId('focus-checkin-reply')).toHaveTextContent('Then ask Yaman for the forms first.');
        await act(async () => { fireEvent.click(within(screen.getByTestId('focus-checkin-reply')).getByRole('button', { name: 'Add task: Ask Yaman for the forms' })); });
        expect(useTaskStore.getState()._allTasks.map((t) => t.title)).toContain('Ask Yaman for the forms');
        fireEvent.click(within(checkIn).getByRole('button', { name: 'Back' }));
        fireEvent.click(within(checkIn).getByRole('button', { name: 'Not yet' }));
        fireEvent.click(within(checkIn).getByRole('button', { name: 'Need info' }));
        await act(async () => { fireEvent.click(screen.getByTestId('focus-checkin-followup')); });
        expect(useTaskStore.getState()._allTasks.map((t) => t.title)).toContain('Get info for: Write the report');
        await act(async () => { fireEvent.click(within(screen.getByTestId('focus-checkin-followup-done')).getByRole('button', { name: 'Undo' })); });
        expect(useTaskStore.getState()._allTasks.map((t) => t.title)).not.toContain('Get info for: Write the report');
    });

    it('without a task the finish stays simple', () => {
        renderHost();
        act(() => setSnapshot({ selectedTaskId: undefined }));
        act(() => setSnapshot({ selectedTaskId: undefined, lastEvent: 'focus-finished', running: false }));
        const finish = screen.getByTestId('focus-summary');
        expect(within(finish).getByRole('heading', { name: 'Session complete' })).toBeInTheDocument();
        expect(within(finish).getAllByRole('button').map((b) => b.textContent)).toEqual(['Take a break', 'Keep going']);
        fireEvent.click(within(finish).getByRole('button', { name: 'Take a break' }));
        expect(usePomodoroStore.getState().snapshot.timerState.phase).toBe('break');
    });

    it('a finish while minimised comes back to the full stage', () => {
        renderHost();
        act(() => setSnapshot({}));
        fireEvent.click(screen.getByRole('button', { name: 'Minimise' }));
        act(() => setSnapshot({ lastEvent: 'focus-finished', running: false }));
        expect(stage()).toBeInTheDocument();
        expect(screen.getByTestId('focus-checkin')).toBeInTheDocument();
    });

    it('a break shows what is next and can be skipped to a ready state', () => {
        renderHost();
        act(() => setSnapshot({}));
        act(() => setSnapshot({ timerState: { ...createPomodoroState(DEFAULT_POMODORO_DURATIONS), phase: 'break', remainingSeconds: 300, isRunning: true } }));
        const brk = screen.getByTestId('focus-break');
        expect(brk).toHaveTextContent('Up next: Step 0');
        expect(stage()).toHaveTextContent('05:00');
        expect(screen.getByTestId('focus-sub')).toHaveTextContent('Break');
        expect(screen.getByTestId('focus-ambient')).toHaveAttribute('data-kind', 'break');
        fireEvent.click(screen.getByRole('button', { name: 'Skip break' }));
        expect(running()).toBe(false);
        expect(usePomodoroStore.getState().snapshot.lastEvent).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Another session' }));
        expect(running()).toBe(true);
        expect(usePomodoroStore.getState().snapshot.timerState.phase).toBe('focus');
    });

    it('AI off: no steps are made up, only a quiet "Add a step" link and the local coach line', async () => {
        const task = makeTask(undefined);
        useTaskStore.setState({ tasks: [task], _allTasks: [task] });
        renderHost();
        await act(async () => { setSnapshot({}); });
        expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
        expect(screen.queryByRole('button', { name: 'Suggest steps' })).toBeNull();
        const coach = screen.getByTestId('focus-coach');
        expect(coach).toHaveAttribute('data-source', 'fallback');
        // One short line: no question about time, no chips, no reply box.
        expect(coach).not.toHaveTextContent(/how long/i);
        expect(within(coach).queryAllByRole('button')).toHaveLength(0);
        expect(within(coach).queryByRole('textbox')).toBeNull();
        expect(screen.getByTestId('focus-coach-lead').textContent?.length).toBeGreaterThan(0);
        fireEvent.click(screen.getByRole('button', { name: 'Add a step' }));
        const input = screen.getByRole('textbox', { name: 'Add a step' });
        fireEvent.change(input, { target: { value: 'Call the repair service' } });
        await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });
        expect(useTaskStore.getState()._allTasks[0]!.checklist!.map((c) => c.title)).toEqual(['Call the repair service']);
    });

    it('keeps the running stage to essentials: clock, task card, end, pause, minimise, close', () => {
        const project = { id: 'p1', title: 'Launch', status: 'active', color: '#3366ff', order: 0, tagIds: [], createdAt: iso, updatedAt: iso } as never;
        const task = { ...makeTask(steps(2)), projectId: 'p1' };
        useTaskStore.setState({ tasks: [task], _allTasks: [task], projects: [project], _allProjects: [project] } as never);
        renderHost();
        act(() => setSnapshot({}));
        const buttons = within(stage()).getAllByRole('button').filter((b) => !b.closest('ol') && !b.closest('label') && !b.closest('[data-testid="focus-coach"]') && !b.closest('[data-testid="focus-checklist"]'));
        expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Enter full screen', 'Minimise', 'Hide, keep timer running', 'Remove 5 minutes', 'Add 5 minutes', 'End session', 'Pause']);
        expect(stage()).toHaveTextContent('Launch');
        expect(screen.queryByRole('button', { name: 'Switch to Break' })).toBeNull();
        expect(screen.getByRole('timer')).toHaveAccessibleName('25:00 remaining');
    });
    it('docks the mini card clear of the Assistant dock and keeps the dragged position', () => {
        const dock = document.createElement('aside');
        dock.setAttribute('data-assistant-dock', '');
        dock.getBoundingClientRect = () => ({ width: 380, height: 800, top: 0, left: 900, right: 1280, bottom: 800, x: 900, y: 0, toJSON: () => ({}) });
        document.body.appendChild(dock);
        try {
            useFocusSessionStore.getState().setMiniPosition({ right: 40, bottom: 60 });
            renderHost();
            act(() => setSnapshot({}));
            fireEvent.click(screen.getByRole('button', { name: 'Minimise' }));
            const mini = screen.getByTestId('focus-mini');
            expect(mini.style.right).toBe('420px');
            expect(mini.style.bottom).toBe('60px');
            expect(screen.getByTestId('focus-mini')).toHaveAttribute('aria-label', 'Focus session');
        } finally {
            dock.remove();
        }
    });

    describe('− / + beside the time', () => {
        const timer = () => usePomodoroStore.getState().snapshot.timerState;

        it('the stage: ±5 min on the running focus, with a brief note; keyboard = / − and Up / Down on the clock', () => {
            renderHost();
            act(() => setSnapshot({ updatedAtMs: Date.now() }));
            fireEvent.click(within(stage()).getByRole('button', { name: 'Add 5 minutes' }));
            expect(timer().phaseTotalSeconds).toBe(30 * 60);
            expect(screen.getByRole('timer')).toHaveAccessibleName('30:00 remaining');
            expect(screen.getByTestId('focus-adjust-flash')).toHaveTextContent('+5 min');
            fireEvent.click(within(stage()).getByRole('button', { name: 'Remove 5 minutes' }));
            expect(timer().phaseTotalSeconds).toBeUndefined();
            expect(screen.getByTestId('focus-adjust-flash')).toHaveTextContent('−5 min');
            fireEvent.keyDown(stage(), { key: '=' });
            expect(timer().remainingSeconds).toBe(30 * 60);
            fireEvent.keyDown(stage(), { key: '-' });
            expect(timer().remainingSeconds).toBe(25 * 60);
            const clock = screen.getByRole('timer');
            clock.focus();
            fireEvent.keyDown(clock, { key: 'ArrowUp' });
            expect(timer().remainingSeconds).toBe(30 * 60);
            fireEvent.keyDown(clock, { key: 'ArrowDown' });
            expect(timer().remainingSeconds).toBe(25 * 60);
            // Typing in a field is not a shortcut.
            fireEvent.click(screen.getByRole('button', { name: 'Add a step' }));
            fireEvent.keyDown(screen.getByRole('textbox', { name: 'Add a step' }), { key: '-' });
            expect(timer().remainingSeconds).toBe(25 * 60);
        });

        it('"−" keeps at least a minute and is disabled at one minute; the break works too', () => {
            renderHost();
            act(() => setSnapshot({ updatedAtMs: Date.now(), timerState: { ...createPomodoroState(DEFAULT_POMODORO_DURATIONS), remainingSeconds: 150, isRunning: true } }));
            fireEvent.click(within(stage()).getByRole('button', { name: 'Remove 5 minutes' }));
            expect(timer().remainingSeconds).toBe(60);
            expect(within(stage()).getByRole('button', { name: 'Remove 5 minutes' })).toBeDisabled();
            act(() => setSnapshot({ updatedAtMs: Date.now(), timerState: { ...createPomodoroState(DEFAULT_POMODORO_DURATIONS, 'break'), remainingSeconds: 120, isRunning: true } }));
            fireEvent.click(within(stage()).getByRole('button', { name: 'Add 5 minutes' }));
            expect(timer()).toMatchObject({ phase: 'break', remainingSeconds: 420, phaseTotalSeconds: 600 });
        });

        it('overtime: "+" turns the count-up into 5 more planned minutes; "−" is disabled', () => {
            renderHost();
            act(() => setSnapshot({ updatedAtMs: Date.now(), timerState: { ...createPomodoroState(DEFAULT_POMODORO_DURATIONS), remainingSeconds: 0, overtimeSeconds: 90, keepGoing: true, isRunning: true } }));
            expect(within(stage()).getByRole('button', { name: 'Remove 5 minutes' })).toBeDisabled();
            fireEvent.click(within(stage()).getByRole('button', { name: 'Add 5 minutes' }));
            expect(timer().overtimeSeconds).toBeUndefined();
            expect(timer().remainingSeconds).toBe(300);
            expect(screen.getByRole('timer')).toHaveAccessibleName('05:00 remaining');
        });

        it('the minimised card has them too', () => {
            renderHost();
            act(() => setSnapshot({ updatedAtMs: Date.now() }));
            fireEvent.click(screen.getByRole('button', { name: 'Minimise' }));
            const mini = screen.getByTestId('focus-mini');
            fireEvent.click(within(mini).getByRole('button', { name: 'Add 5 minutes' }));
            expect(within(mini).getByRole('timer')).toHaveTextContent('30:00');
            fireEvent.click(within(mini).getByRole('button', { name: 'Remove 5 minutes' }));
            fireEvent.click(within(mini).getByRole('button', { name: 'Remove 5 minutes' }));
            expect(within(mini).getByRole('timer')).toHaveTextContent('20:00');
        });
    });

    describe('coach', () => {
        const washing = JSON.stringify({
            estimateMinutes: 10,
            estimateNote: 'One call and a booking, about 10 minutes',
            approach: 'delegate',
            suggestion: 'Call a repair service, then get back to your day',
            motivation: 'Book it now and the rest of the afternoon is yours.',
            question: { text: 'Do you already have a repair service?', options: ['Yes, calling now', 'Need to find one'] },
            steps: [{ title: 'Unplug the machine' }, { title: 'Clear the drain pump filter' }],
        });
        const useWashing = () => {
            const task = { ...makeTask(undefined), title: 'Fix the washing machine' };
            useTaskStore.setState({ tasks: [task], _allTasks: [task] });
            ai.coach = washing;
        };
        const startCoach = async () => {
            renderHost();
            await act(async () => { setSnapshot({}); });
            return screen.getByTestId('focus-coach');
        };

        it('shows estimate, the real next action and one question; no how-to steps for a service job', async () => {
            useWashing();
            const coach = await startCoach();
            expect(coach).toHaveAttribute('data-source', 'ai');
            expect(screen.getByTestId('focus-coach-estimate')).toHaveTextContent('About 10 min· One call and a booking, about 10 minutes');
            expect(screen.getByTestId('focus-coach-lead')).toHaveTextContent('Call a repair service, then get back to your day');
            expect(coach).toHaveTextContent('Book it now and the rest of the afternoon is yours.');
            expect(screen.queryByTestId('focus-coach-steps')).toBeNull();
            expect(coach).not.toHaveTextContent('Unplug');
            expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
            expect(localStorage.getItem('stride:focus:now:v1')).toContain('Call a repair service');
            fireEvent.click(within(coach).getByRole('button', { name: 'Hide coach' }));
            expect(within(coach).queryByText('Do you already have a repair service?')).toBeNull();
            expect(within(coach).getByRole('button', { name: 'Show coach' })).toHaveAttribute('aria-expanded', 'false');
        });

        it('a chip answer sends one follow-up turn; suggested actions apply only on click, with Undo', async () => {
            useWashing();
            ai.reply = JSON.stringify({ reply: 'Then book a visit for tomorrow morning and enjoy the evening.', actions: [{ type: 'set_time_estimate', minutes: 15 }, { type: 'add_followup_task', title: 'Book a repair visit' }, { type: 'delete_everything' }] });
            const coach = await startCoach();
            await act(async () => { fireEvent.click(within(coach).getByRole('button', { name: 'Need to find one' })); });
            expect(screen.getByTestId('focus-coach-reply')).toHaveTextContent('Then book a visit for tomorrow morning and enjoy the evening.');
            expect(within(coach).queryByRole('button', { name: 'Yes, calling now' })).toBeNull();
            const actions = screen.getAllByTestId('focus-coach-action');
            // The chat never offers a time estimate: next to a running timer it reads like a timer change.
            expect(actions.map((a) => a.textContent)).toEqual(['Add task: Book a repair visit']);
            const before = useTaskStore.getState()._allTasks.filter((t) => !t.deletedAt).length;
            await act(async () => { fireEvent.click(actions[0]!); });
            expect(useTaskStore.getState()._allTasks.filter((t) => !t.deletedAt).some((t) => t.title === 'Book a repair visit')).toBe(true);
            await act(async () => { fireEvent.click(within(screen.getByTestId('focus-coach-action-done')).getByRole('button', { name: 'Undo' })); });
            expect(useTaskStore.getState()._allTasks.filter((t) => !t.deletedAt).length).toBe(before);
        });

        it('stays light: at most three exchanges', async () => {
            useWashing();
            ai.reply = JSON.stringify({ reply: 'Noted.', actions: [] });
            const coach = await startCoach();
            for (const text of ['one', 'two', 'three']) {
                const box = within(coach).getByRole('textbox', { name: 'Reply to the coach' });
                fireEvent.change(box, { target: { value: text } });
                await act(async () => { fireEvent.keyDown(box, { key: 'Enter' }); });
            }
            expect(screen.getAllByTestId('focus-coach-turn')).toHaveLength(3);
            expect(within(coach).queryByRole('textbox', { name: 'Reply to the coach' })).toBeNull();
        });

        it('Not useful dismisses the coach for this session and stores the feedback locally', async () => {
            useWashing();
            const coach = await startCoach();
            fireEvent.click(within(screen.getByTestId('focus-coach-feedback')).getByRole('button', { name: 'Not useful' }));
            expect(screen.queryByTestId('focus-coach')).toBeNull();
            expect(coach).not.toBeInTheDocument();
            expect(screen.getByText('Fix the washing machine')).toBeInTheDocument();
            const log = JSON.parse(localStorage.getItem('stride:focus:coach-feedback:v1')!);
            expect(log).toEqual([expect.objectContaining({ taskId: 't1', kind: 'coach', verdict: 'not_useful', approach: 'delegate', digital: false })]);
            expect(localStorage.getItem('stride:focus:now:v1')).toBeNull();
        });

        it("Doesn't make sense on a reply removes just that reply", async () => {
            useWashing();
            ai.reply = JSON.stringify({ reply: 'Open the back panel first.', actions: [] });
            const coach = await startCoach();
            await act(async () => { fireEvent.click(within(coach).getByRole('button', { name: 'Yes, calling now' })); });
            fireEvent.click(within(screen.getByTestId('focus-coach-reply-feedback')).getByRole('button', { name: "Doesn't make sense" }));
            expect(screen.queryByTestId('focus-coach-reply')).toBeNull();
            expect(screen.getByTestId('focus-coach')).toBeInTheDocument();
            expect(JSON.parse(localStorage.getItem('stride:focus:coach-feedback:v1')!)[0]).toMatchObject({ kind: 'reply', verdict: 'nonsense' });
        });

        it('grounded steps (from a note) are a suggestion: Add to checklist is one click and undoable', async () => {
            const task = { ...makeTask(undefined), title: 'Talk to Yaman about HDFC visit', description: 'Bring KYC papers. Ask about the loan file.' };
            useTaskStore.setState({ tasks: [task], _allTasks: [task] });
            ai.coach = JSON.stringify({
                approach: 'do', suggestion: 'Call Yaman and fix a date for the visit', motivation: 'Ten minutes now saves a week of back and forth.',
                steps: [{ title: 'Confirm the KYC papers', source: 'from note' }, { title: 'Find his number', source: 'from note' }],
            });
            const coach = await startCoach();
            const block = screen.getByTestId('focus-coach-steps');
            expect(block).toHaveTextContent('Confirm the KYC papers');
            expect(block).toHaveTextContent('from note');
            expect(block).not.toHaveTextContent('Find his number');
            expect(useTaskStore.getState()._allTasks[0]!.checklist).toBeUndefined();
            await act(async () => { fireEvent.click(within(block).getByRole('button', { name: 'Add to checklist' })); });
            expect(useTaskStore.getState()._allTasks[0]!.checklist!.map((c) => c.title)).toEqual(['Confirm the KYC papers']);
            await act(async () => { fireEvent.click(within(block).getByRole('button', { name: 'Undo' })); });
            expect(useTaskStore.getState()._allTasks[0]!.checklist).toEqual([]);
            fireEvent.click(within(screen.getByTestId('focus-coach-feedback')).getByRole('button', { name: 'Not useful' }));
            expect(screen.queryByTestId('focus-coach-steps')).toBeNull();
            expect(coach).toBeInTheDocument();
        });

        const editing = JSON.stringify({
            estimateMinutes: 40,
            estimateNote: 'two cuts and an export',
            approach: 'do',
            suggestion: 'Make the two cuts Rhea asked for, then export',
            motivation: 'Forty focused minutes and it is off your desk.',
            question: { text: 'Is Rhea\'s feedback final?', options: ['Yes, final', 'Still waiting'] },
            steps: [{ title: 'Review Rhea\'s notes' }, { title: 'Open your laptop' }, { title: 'Decide on the two cuts' }, { title: 'Send the export to Rhea' }],
        });
        const useEditing = (checklist?: Task['checklist']) => {
            const task = { ...makeTask(checklist), title: 'Edit the launch video for Rhea' };
            useTaskStore.setState({ tasks: [task], _allTasks: [task] });
            ai.coach = editing;
        };
        const checklistTitles = () => (useTaskStore.getState()._allTasks[0]!.checklist ?? []).map((c) => c.title);
        const timer = () => usePomodoroStore.getState().snapshot.timerState;

        it('offers its estimate as "Set timer to 40 min": the running focus becomes 40 min and the estimate is saved; Undo restores both', async () => {
            useEditing(steps(2));
            renderHost();
            await act(async () => { setSnapshot({ updatedAtMs: Date.now() }); });
            expect(screen.getByTestId('focus-coach-estimate')).toHaveTextContent('About 40 min· two cuts and an export');
            const offer = screen.getByTestId('focus-coach-timer-offer');
            expect(within(offer).getByRole('button', { name: 'Keep 25' })).toBeInTheDocument();
            await act(async () => { fireEvent.click(within(offer).getByRole('button', { name: 'Set timer to 40 min' })); });
            expect(timer().phaseTotalSeconds).toBe(40 * 60);
            expect(timer().isRunning).toBe(true);
            expect(screen.getByRole('timer')).toHaveAccessibleName('40:00 remaining');
            expect(useTaskStore.getState()._allTasks[0]!.timeEstimate).toBe('custom:40');
            expect(screen.getByTestId('focus-coach-set-timer-done')).toHaveTextContent('Timer set to 40 min');
            await act(async () => { fireEvent.click(within(screen.getByTestId('focus-coach-set-timer-done')).getByRole('button', { name: 'Undo' })); });
            expect(timer().phaseTotalSeconds).toBeUndefined();
            expect(screen.getByRole('timer')).toHaveAccessibleName('25:00 remaining');
            expect(useTaskStore.getState()._allTasks[0]!.timeEstimate).toBeUndefined();
            // "Keep 25" just puts the offer away.
            fireEvent.click(within(screen.getByTestId('focus-coach-timer-offer')).getByRole('button', { name: 'Keep 25' }));
            expect(screen.queryByTestId('focus-coach-timer-offer')).toBeNull();
            expect(timer().phaseTotalSeconds).toBeUndefined();
        });

        it('Set timer before the session really starts (paused at the top) sets this session\'s length', async () => {
            useEditing(steps(2));
            renderHost();
            await act(async () => { setSnapshot({ updatedAtMs: Date.now() }); });
            fireEvent.click(within(stage()).getByRole('button', { name: 'Pause' }));
            await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Set timer to 40 min' })); });
            expect(timer()).toMatchObject({ isRunning: false, remainingSeconds: 2400, phaseTotalSeconds: 2400 });
        });

        it('with no checklist, writes 3–5 real next steps in by itself (trivial ones dropped), with Undo', async () => {
            useEditing(undefined);
            renderHost();
            await act(async () => { setSnapshot({}); });
            expect(checklistTitles()).toEqual(['Review Rhea\'s notes', 'Decide on the two cuts', 'Send the export to Rhea']);
            expect(screen.getByTestId('focus-coach-steps-note')).toHaveTextContent('Added 3 steps');
            expect(screen.getAllByRole('checkbox')).toHaveLength(1);
            await act(async () => { fireEvent.click(within(screen.getByTestId('focus-coach-steps-note')).getByRole('button', { name: 'Undo' })); });
            expect(checklistTitles()).toEqual([]);
            expect(screen.queryByTestId('focus-coach-steps')).toBeNull();
        });

        it('"Not useful" on the steps it added takes them off again (undoable) and records it', async () => {
            useEditing(undefined);
            renderHost();
            await act(async () => { setSnapshot({}); });
            await act(async () => { fireEvent.click(within(screen.getByTestId('focus-coach-feedback')).getByRole('button', { name: 'Not useful' })); });
            expect(checklistTitles()).toEqual([]);
            expect(screen.getByTestId('focus-coach-steps-note')).toHaveTextContent('Removed the steps');
            expect(JSON.parse(localStorage.getItem('stride:focus:coach-feedback:v1')!)[0]).toMatchObject({ kind: 'steps', verdict: 'not_useful' });
            await act(async () => { fireEvent.click(within(screen.getByTestId('focus-coach-steps-note')).getByRole('button', { name: 'Undo' })); });
            expect(checklistTitles()).toEqual(['Review Rhea\'s notes', 'Decide on the two cuts', 'Send the export to Rhea']);
        });

        it('a task that already has steps is left alone; "Suggest more steps" shows the extras to add', async () => {
            useEditing([{ id: 'own', title: 'Review Rhea\'s notes', isCompleted: false }]);
            renderHost();
            await act(async () => { setSnapshot({}); });
            expect(checklistTitles()).toEqual(['Review Rhea\'s notes']);
            const block = screen.getByTestId('focus-coach-steps');
            expect(block).not.toHaveTextContent('Decide on the two cuts');
            fireEvent.click(within(block).getByRole('button', { name: 'Suggest more steps' }));
            const shown = screen.getByTestId('focus-coach-steps');
            expect(shown).toHaveTextContent('Decide on the two cuts');
            expect(shown).not.toHaveTextContent('Open your laptop');
            await act(async () => { fireEvent.click(within(shown).getByRole('button', { name: 'Add to checklist' })); });
            expect(checklistTitles()).toEqual(['Review Rhea\'s notes', 'Decide on the two cuts', 'Send the export to Rhea']);
        });

        it('an answer can refine the steps ("Update steps") and the timer ("Set timer to 30 min")', async () => {
            useEditing(undefined);
            ai.reply = JSON.stringify({
                reply: 'Then skip the review and go straight to the cuts.',
                actions: [{ type: 'update_steps', steps: ['Make the two cuts', 'Unplug the machine', 'Export at 1080p', 'Send it to Rhea'] }, { type: 'set_timer', minutes: 30 }],
            });
            renderHost();
            await act(async () => { setSnapshot({ updatedAtMs: Date.now() }); });
            // The coach asks about the task itself, never about time.
            expect(screen.getByText('Is Rhea\'s feedback final?')).toBeInTheDocument();
            await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Yes, final' })); });
            expect(screen.getByTestId('focus-coach-new-steps')).toHaveTextContent('Make the two cuts');
            expect(screen.getByTestId('focus-coach-new-steps')).not.toHaveTextContent('Unplug');
            await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Update steps' })); });
            expect(checklistTitles()).toEqual(['Make the two cuts', 'Export at 1080p', 'Send it to Rhea']);
            await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Set timer to 30 min' })); });
            expect(timer().phaseTotalSeconds).toBe(30 * 60);
            expect(useTaskStore.getState()._allTasks[0]!.timeEstimate).toBe('30min');
            expect(screen.getByText('Timer set to 30 min')).toBeInTheDocument();
            await act(async () => { fireEvent.click(within(screen.getByTestId('focus-coach-update-steps-done')).getByRole('button', { name: 'Undo' })); });
            expect(checklistTitles()).toEqual(['Review Rhea\'s notes', 'Decide on the two cuts', 'Send the export to Rhea']);
        });

        it('feeds recent negative feedback into the next coach prompt', async () => {
            localStorage.setItem('stride:focus:coach-feedback:v1', JSON.stringify([
                { taskId: 'x', taskTitle: 'Fix the dryer', kind: 'steps', verdict: 'not_useful', at: iso, digital: false },
            ]));
            useWashing();
            const service = await import('../../lib/focus-ai-service');
            await startCoach();
            const calls = vi.mocked(service.requestFocusCoach).mock.calls;
            const input = calls[calls.length - 1]![1];
            expect(input.feedbackSummary).toEqual(['User marked suggested steps on hands-on or service tasks as not useful (1x), e.g. "Fix the dryer".']);
        });
    });
});
