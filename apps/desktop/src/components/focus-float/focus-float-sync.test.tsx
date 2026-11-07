import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

type Handler = (event: { payload: unknown }) => void;
const bus = vi.hoisted(() => ({
    listeners: new Map<string, Set<(event: { payload: unknown }) => void>>(),
    emitTo: vi.fn(async (_target: string, _event: string, _payload?: unknown) => undefined),
    invoke: vi.fn(async (_command: string, _args?: Record<string, unknown>) => undefined),
}));

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn(async (event: string, handler: Handler) => {
        const set = bus.listeners.get(event) ?? new Set();
        set.add(handler);
        bus.listeners.set(event, set);
        return () => set.delete(handler);
    }),
    emitTo: bus.emitTo,
}));
vi.mock('@tauri-apps/api/window', () => ({
    getCurrentWindow: () => ({ startDragging: vi.fn(async () => undefined) }),
}));
vi.mock('../../lib/runtime', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../lib/runtime')>()),
    isTauriRuntime: () => true,
}));
vi.mock('../../lib/tauri-invoke', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../lib/tauri-invoke')>()),
    invokeNative: bus.invoke,
}));

import { LanguageProvider } from '../../contexts/language-context';
import { FocusFloatApp } from '../../FocusFloatApp';
import {
    FOCUS_FLOAT_ACTION_EVENT,
    FOCUS_FLOAT_OPEN_EVENT,
    FOCUS_FLOAT_REQUEST_EVENT,
    FOCUS_FLOAT_STATE_EVENT,
    deriveFocusFloatDisplay,
    focusFloatStateChanged,
    type FocusFloatState,
} from '../../lib/focus-float-window';
import { FOCUS_FLOAT_AUTO_SHOW_STORAGE_KEY } from '../../lib/focus-float-preferences';
import { useFocusFloatStore } from '../../store/focus-float-store';
import { useFocusFloatBridge, type FocusFloatHandlers } from '../focus/useFocusFloatBridge';

const fire = (event: string, payload: unknown = {}) => {
    act(() => { bus.listeners.get(event)?.forEach((handler) => handler({ payload })); });
};
const listening = (event: string) => waitFor(() => expect(bus.listeners.get(event)?.size ?? 0).toBeGreaterThan(0));
const actionsSent = () => bus.emitTo.mock.calls
    .filter(([target, event]) => target === 'main' && event === FOCUS_FLOAT_ACTION_EVENT)
    .map(([, , payload]) => (payload as { action: string }).action);

const makeState = (overrides: Partial<FocusFloatState> = {}): FocusFloatState => ({
    timer: { phase: 'focus', remainingSeconds: 600, isRunning: true, completedFocusSessions: 0 },
    durations: { focusMinutes: 25, breakMinutes: 5 },
    updatedAtMs: Date.now(),
    autoStart: {},
    view: 'focus',
    taskTitle: 'Send Rhea the photos',
    currentStep: 'Pick the best ten',
    nextStep: null,
    ...overrides,
});

beforeEach(() => {
    bus.listeners.clear();
    bus.emitTo.mockClear();
    bus.invoke.mockClear();
    window.localStorage.clear();
    useFocusFloatStore.setState({ requested: false, closedByUser: false, visible: false });
});
afterEach(() => vi.restoreAllMocks());

describe('float window (receives state, sends actions)', () => {
    const renderApp = () => render(<LanguageProvider><FocusFloatApp /></LanguageProvider>);

    it('asks the main window for state on start, then shows what it receives', async () => {
        renderApp();
        await listening(FOCUS_FLOAT_STATE_EVENT);
        await waitFor(() => expect(actionsSent()).toContain('sync'));
        fire(FOCUS_FLOAT_STATE_EVENT, makeState());
        expect(screen.getByRole('timer')).toHaveTextContent('10:00');
        expect(screen.getByText('Send Rhea the photos')).toBeInTheDocument();
    });

    it('pause is optimistic here and sent to the main window; open and close go native', async () => {
        renderApp();
        await listening(FOCUS_FLOAT_STATE_EVENT);
        fire(FOCUS_FLOAT_STATE_EVENT, makeState());
        fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
        expect(screen.getByText('Paused')).toBeInTheDocument();
        await waitFor(() => expect(actionsSent()).toContain('toggle'));

        fireEvent.click(screen.getByRole('button', { name: 'Open Stride' }));
        expect(bus.invoke).toHaveBeenCalledWith('focus_float_open_main');

        fireEvent.click(screen.getByRole('button', { name: /Close floating timer/ }));
        expect(bus.invoke).toHaveBeenCalledWith('focus_float_hide');
        await waitFor(() => expect(actionsSent()).toContain('close'));
    });

    it('overtime: counts up "+M:SS" in a calmer tone with a faint second lap; Pause waits for the main window', async () => {
        renderApp();
        await listening(FOCUS_FLOAT_STATE_EVENT);
        fire(FOCUS_FLOAT_STATE_EVENT, makeState({ timer: { phase: 'focus', remainingSeconds: 0, overtimeSeconds: 75, keepGoing: true, isRunning: true, completedFocusSessions: 0 } }));
        expect(screen.getByRole('timer')).toHaveTextContent('+1:15');
        expect(screen.getByTestId('focus-float')).toHaveAttribute('data-overtime', 'true');
        expect(screen.getByTestId('focus-float-status')).toHaveTextContent('Over time');
        fireEvent.click(screen.getByRole('button', { name: 'Pause and check in' }));
        await waitFor(() => expect(actionsSent()).toContain('toggle'));
        // Not flipped locally to "Paused": the session ends in the main window, which sends the check-in state.
        expect(screen.getByTestId('focus-float-status')).toHaveTextContent('Over time');
    });

    it('reaching 0:00 into overtime is not reported as a finished session', () => {
        const state = makeState({ timer: { phase: 'focus', remainingSeconds: 2, keepGoing: true, isRunning: true, completedFocusSessions: 0 }, updatedAtMs: Date.now() - 10_000 });
        const display = deriveFocusFloatDisplay(state, Date.now());
        expect(display.crossed).toBeNull();
        expect(display.view).toBe('focus');
        expect(display.overtimeSeconds).toBeGreaterThanOrEqual(7);
    });

    it('a new state with added time is sent to the float even though the clock is not paused', () => {
        const before = makeState();
        const after = makeState({ timer: { ...before.timer, remainingSeconds: 900, phaseTotalSeconds: 1800, extendedSeconds: 300 } });
        expect(focusFloatStateChanged(before, after)).toBe(true);
        expect(deriveFocusFloatDisplay(after, after.updatedAtMs).totalSeconds).toBe(1800);
    });

    it('− / + change the time here at once and ask the main window to do the same; − is off in overtime', async () => {
        renderApp();
        await listening(FOCUS_FLOAT_STATE_EVENT);
        fire(FOCUS_FLOAT_STATE_EVENT, makeState());
        fireEvent.click(screen.getByRole('button', { name: 'Add 5 minutes' }));
        expect(screen.getByRole('timer')).toHaveTextContent('15:00');
        await waitFor(() => expect(actionsSent()).toContain('add-time'));
        fireEvent.click(screen.getByRole('button', { name: 'Remove 5 minutes' }));
        expect(screen.getByRole('timer')).toHaveTextContent('10:00');
        await waitFor(() => expect(actionsSent()).toContain('remove-time'));
        fire(FOCUS_FLOAT_STATE_EVENT, makeState({ timer: { phase: 'focus', remainingSeconds: 0, overtimeSeconds: 30, keepGoing: true, isRunning: true, completedFocusSessions: 0 } }));
        expect(screen.getByRole('button', { name: 'Remove 5 minutes' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Add 5 minutes' }));
        expect(screen.getByRole('timer')).toHaveTextContent('05:00');
    });

    it('expand resizes the native window', async () => {
        renderApp();
        await listening(FOCUS_FLOAT_STATE_EVENT);
        fire(FOCUS_FLOAT_STATE_EVENT, makeState());
        fireEvent.click(screen.getByRole('button', { name: 'Show steps' }));
        expect(bus.invoke).toHaveBeenCalledWith('focus_float_set_expanded', { expanded: true });
    });

    it('a session that ended here first asks the main window to catch up (once)', async () => {
        renderApp();
        await listening(FOCUS_FLOAT_STATE_EVENT);
        fire(FOCUS_FLOAT_STATE_EVENT, makeState({
            timer: { phase: 'focus', remainingSeconds: 2, isRunning: true, completedFocusSessions: 0 },
            updatedAtMs: Date.now() - 5000,
        }));
        expect(screen.getByTestId('focus-float-status')).toHaveTextContent('Session complete');
        await waitFor(() => expect(actionsSent().filter((action) => action === 'tick')).toHaveLength(1));
    });
});

describe('main window bridge (decides visibility, pushes state, runs actions)', () => {
    function Harness(props: { state: FocusFloatState | null; live: boolean; presentation?: 'full' | 'mini' | 'hidden'; handlers: FocusFloatHandlers }) {
        useFocusFloatBridge({ state: props.state, live: props.live, presentation: props.presentation ?? 'full', handlers: props.handlers });
        return null;
    }
    const handlers = () => ({ toggle: vi.fn(), open: vi.fn(), startNext: vi.fn(), tick: vi.fn(), adjust: vi.fn() });

    it('auto-shows the float when Stride is not in front, and sends it the state first', async () => {
        vi.spyOn(document, 'hasFocus').mockReturnValue(false);
        const state = makeState();
        render(<Harness state={state} live handlers={handlers()} />);
        await waitFor(() => expect(bus.invoke).toHaveBeenCalledWith('focus_float_show'));
        expect(bus.emitTo).toHaveBeenCalledWith('focus-float', FOCUS_FLOAT_STATE_EVENT, state);
        await waitFor(() => expect(useFocusFloatStore.getState().visible).toBe(true));
    });

    it('keeps the float away while the full stage is in front, or with the setting off', async () => {
        vi.spyOn(document, 'hasFocus').mockReturnValue(true);
        const { rerender } = render(<Harness state={makeState()} live handlers={handlers()} />);
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(bus.invoke).not.toHaveBeenCalledWith('focus_float_show');

        window.localStorage.setItem(FOCUS_FLOAT_AUTO_SHOW_STORAGE_KEY, 'false');
        rerender(<Harness state={makeState()} live presentation="mini" handlers={handlers()} />);
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(bus.invoke).not.toHaveBeenCalledWith('focus_float_show');

        // Asked for explicitly (Minimise / Float timer): shows even with the setting off.
        await listening(FOCUS_FLOAT_REQUEST_EVENT);
        fire(FOCUS_FLOAT_REQUEST_EVENT);
        await waitFor(() => expect(bus.invoke).toHaveBeenCalledWith('focus_float_show'));
    });

    it('runs the float buttons and remembers a close for the rest of the session', async () => {
        vi.spyOn(document, 'hasFocus').mockReturnValue(false);
        const run = handlers();
        const { rerender } = render(<Harness state={makeState()} live handlers={run} />);
        await listening(FOCUS_FLOAT_ACTION_EVENT);
        await waitFor(() => expect(useFocusFloatStore.getState().visible).toBe(true));

        fire(FOCUS_FLOAT_ACTION_EVENT, { action: 'toggle' });
        fire(FOCUS_FLOAT_ACTION_EVENT, { action: 'start-next' });
        fire(FOCUS_FLOAT_ACTION_EVENT, { action: 'tick' });
        fire(FOCUS_FLOAT_ACTION_EVENT, { action: 'add-time' });
        fire(FOCUS_FLOAT_ACTION_EVENT, { action: 'remove-time' });
        fire(FOCUS_FLOAT_OPEN_EVENT);
        expect(run.adjust.mock.calls).toEqual([[5], [-5]]);
        expect(run.toggle).toHaveBeenCalledTimes(1);
        expect(run.startNext).toHaveBeenCalledTimes(1);
        expect(run.tick).toHaveBeenCalledTimes(1);
        expect(run.open).toHaveBeenCalledTimes(1);


        bus.emitTo.mockClear();
        fire(FOCUS_FLOAT_ACTION_EVENT, { action: 'sync' });
        await waitFor(() => expect(bus.emitTo).toHaveBeenCalledWith('focus-float', FOCUS_FLOAT_STATE_EVENT, expect.objectContaining({ taskTitle: 'Send Rhea the photos' })));

        fire(FOCUS_FLOAT_ACTION_EVENT, { action: 'close' });
        expect(useFocusFloatStore.getState()).toMatchObject({ closedByUser: true, visible: false });
        bus.invoke.mockClear();
        rerender(<Harness state={makeState({ currentStep: 'Upload' })} live handlers={run} />);
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(bus.invoke).not.toHaveBeenCalledWith('focus_float_show');

        // The session ends: the float goes, and next session starts fresh.
        rerender(<Harness state={null} live={false} handlers={run} />);
        expect(useFocusFloatStore.getState().closedByUser).toBe(false);
    });

    it('hides the task while Stride is locked', async () => {
        const { useAppLockStore } = await import('../../lib/app-lock');
        useAppLockStore.setState({ locked: true });
        vi.spyOn(document, 'hasFocus').mockReturnValue(false);
        render(<Harness state={makeState()} live handlers={handlers()} />);
        await waitFor(() => expect(bus.emitTo).toHaveBeenCalledWith('focus-float', FOCUS_FLOAT_STATE_EVENT, expect.objectContaining({ taskTitle: null, currentStep: null })));
        useAppLockStore.setState({ locked: false });
    });

    it('a session that ends takes the float down', async () => {
        vi.spyOn(document, 'hasFocus').mockReturnValue(false);
        const { rerender } = render(<Harness state={makeState()} live handlers={handlers()} />);
        await waitFor(() => expect(useFocusFloatStore.getState().visible).toBe(true));
        rerender(<Harness state={null} live={false} handlers={handlers()} />);
        await waitFor(() => expect(bus.invoke).toHaveBeenCalledWith('focus_float_hide'));
        expect(useFocusFloatStore.getState().visible).toBe(false);
    });
});
