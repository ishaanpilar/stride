import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { deriveFocusFloatDisplay, type FocusFloatState } from '../../lib/focus-float-window';
import { FocusFloatView, type FocusFloatViewProps } from './FocusFloatView';

const T0 = 1_800_000_000_000;
const tr = (_key: string, fallback: string) => fallback;

const makeState = (overrides: Partial<FocusFloatState> = {}): FocusFloatState => ({
    timer: { phase: 'focus', remainingSeconds: 264, isRunning: true, completedFocusSessions: 0 },
    durations: { focusMinutes: 25, breakMinutes: 5 },
    updatedAtMs: T0,
    autoStart: {},
    view: 'focus',
    taskTitle: 'Send Rhea the photos',
    currentStep: 'Pick the best ten',
    nextStep: 'Upload to the album',
    ...overrides,
});

function renderView(state: FocusFloatState, extra: Partial<FocusFloatViewProps> = {}) {
    const handlers = {
        onToggleRun: vi.fn(),
        onOpen: vi.fn(),
        onToggleExpanded: vi.fn(),
        onClose: vi.fn(),
        onStartNext: vi.fn(),
        onDragStart: vi.fn(),
    };
    render(
        <FocusFloatView
            state={state}
            display={deriveFocusFloatDisplay(state, T0)}
            expanded={false}
            tr={tr}
            {...handlers}
            {...extra}
        />,
    );
    return handlers;
}

describe('FocusFloatView', () => {
    it('focus: big time, the task, and pause / open / expand / close', () => {
        const handlers = renderView(makeState());
        expect(screen.getByTestId('focus-float')).toHaveAttribute('data-view', 'focus');
        expect(screen.getByRole('timer')).toHaveTextContent('04:24');
        expect(screen.getByRole('timer')).toHaveAccessibleName('04:24 remaining');
        expect(screen.getByTestId('focus-float-line')).toHaveTextContent('Send Rhea the photos');
        expect(screen.queryByTestId('focus-float-status')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
        fireEvent.click(screen.getByRole('button', { name: 'Open Stride' }));
        fireEvent.click(screen.getByRole('button', { name: 'Show steps' }));
        fireEvent.click(screen.getByRole('button', { name: 'Close floating timer (timer keeps running)' }));
        expect(handlers.onToggleRun).toHaveBeenCalledTimes(1);
        expect(handlers.onOpen).toHaveBeenCalledTimes(1);
        expect(handlers.onToggleExpanded).toHaveBeenCalledTimes(1);
        expect(handlers.onClose).toHaveBeenCalledTimes(1);
        // Buttons never start a window drag; the surface does.
        expect(handlers.onDragStart).not.toHaveBeenCalled();
        fireEvent.mouseDown(screen.getByRole('timer'), { button: 0 });
        expect(handlers.onDragStart).toHaveBeenCalledTimes(1);
    });

    it('hovering swaps the task for the current step', () => {
        renderView(makeState());
        fireEvent.mouseEnter(screen.getByTestId('focus-float'));
        expect(screen.getByTestId('focus-float-line')).toHaveTextContent('Now: Pick the best ten');
        fireEvent.mouseLeave(screen.getByTestId('focus-float'));
        expect(screen.getByTestId('focus-float-line')).toHaveTextContent('Send Rhea the photos');
    });

    it('expanded: current and next step', () => {
        renderView(makeState(), { expanded: true });
        const steps = screen.getByTestId('focus-float-steps');
        expect(steps).toHaveTextContent('Pick the best ten');
        expect(steps).toHaveTextContent('Upload to the album');
        expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true');
    });

    it('paused: says so and offers Resume', () => {
        const handlers = renderView(makeState({ timer: { phase: 'focus', remainingSeconds: 264, isRunning: false, completedFocusSessions: 0 } }));
        expect(screen.getByTestId('focus-float')).toHaveAttribute('data-paused', 'true');
        expect(screen.getByTestId('focus-float-status')).toHaveTextContent('Paused');
        fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
        expect(handlers.onToggleRun).toHaveBeenCalledTimes(1);
    });

    it('break: teal phase and the Break label', () => {
        renderView(makeState({ timer: { phase: 'break', remainingSeconds: 240, isRunning: true, completedFocusSessions: 1 }, view: 'break' }));
        const root = screen.getByTestId('focus-float');
        expect(root).toHaveAttribute('data-phase', 'break');
        expect(root).toHaveAttribute('data-view', 'break');
        expect(screen.getByTestId('focus-float-status')).toHaveTextContent('Break');
        expect(screen.getByRole('timer')).toHaveTextContent('04:00');
    });

    it('finished: "Session complete" and the way back to Stride, no pause or expand', () => {
        const handlers = renderView(makeState({ timer: { phase: 'break', remainingSeconds: 300, isRunning: false, completedFocusSessions: 1 }, view: 'finish' }));
        expect(screen.getByTestId('focus-float-status')).toHaveTextContent('Session complete');
        expect(screen.queryByRole('timer')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Show steps' })).toBeNull();
        expect(screen.getByRole('status')).toHaveTextContent('Session complete');
        fireEvent.click(screen.getByTestId('focus-float-open-stride'));
        expect(handlers.onOpen).toHaveBeenCalledTimes(1);
    });

    it('ready after a break: start the next session from the float', () => {
        const handlers = renderView(makeState({ timer: { phase: 'focus', remainingSeconds: 1500, isRunning: false, completedFocusSessions: 1 }, view: 'ready' }));
        expect(screen.getByTestId('focus-float-status')).toHaveTextContent('Break over');
        fireEvent.click(screen.getByRole('button', { name: 'Start next session' }));
        expect(handlers.onStartNext).toHaveBeenCalledTimes(1);
    });

    it('timer only (or locked): no task title leaks, a quiet label instead', () => {
        renderView(makeState({ taskTitle: null, currentStep: null, nextStep: null }));
        expect(screen.getByTestId('focus-float-line')).toHaveTextContent('Timer only');
    });
});
