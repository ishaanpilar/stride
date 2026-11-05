import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';

import { usePresence } from './usePresence';
import { Collapse } from '../components/ui/Collapse';
import { installMotionPreference, resetMotionPreferenceForTests, setMotionPreference } from '../lib/motion';

function stubWebAnimations() {
    Object.defineProperty(Element.prototype, 'animate', {
        configurable: true,
        writable: true,
        value: vi.fn(() => ({ finished: Promise.resolve(), cancel: vi.fn() })),
    });
}

describe('usePresence', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        localStorage.clear();
        resetMotionPreferenceForTests();
        installMotionPreference();
        stubWebAnimations();
    });

    afterEach(() => {
        vi.useRealTimers();
        resetMotionPreferenceForTests();
        Reflect.deleteProperty(Element.prototype, 'animate');
    });

    it('stays mounted while closing and unmounts after the exit duration', () => {
        const { result, rerender } = renderHook(({ open }) => usePresence(open, 200), { initialProps: { open: true } });
        expect(result.current.state).toBe('open');

        rerender({ open: false });
        expect(result.current.state).toBe('closing');
        expect(result.current.mounted).toBe(true);

        act(() => { vi.advanceTimersByTime(260); });
        expect(result.current.state).toBe('closed');
        expect(result.current.mounted).toBe(false);
    });

    it('enters through entering -> opening -> open', () => {
        const { result, rerender } = renderHook(({ open }) => usePresence(open, 200), { initialProps: { open: false } });
        expect(result.current.mounted).toBe(false);

        rerender({ open: true });
        expect(result.current.state).toBe('entering');
        act(() => { vi.advanceTimersByTime(40); });
        expect(result.current.state).toBe('opening');
        act(() => { vi.advanceTimersByTime(260); });
        expect(result.current.state).toBe('open');
    });

    it('switches instantly when animations are off', () => {
        setMotionPreference('off');
        const { result, rerender } = renderHook(({ open }) => usePresence(open, 200), { initialProps: { open: true } });
        rerender({ open: false });
        expect(result.current.state).toBe('closed');
        rerender({ open: true });
        expect(result.current.state).toBe('open');
    });
});

describe('Collapse', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        localStorage.clear();
        resetMotionPreferenceForTests();
        installMotionPreference();
        stubWebAnimations();
    });

    afterEach(() => {
        vi.useRealTimers();
        resetMotionPreferenceForTests();
        Reflect.deleteProperty(Element.prototype, 'animate');
    });

    it('animates closed, then hides and unmounts its content', () => {
        const { container, rerender } = render(
            <Collapse open id="section" unmountWhenClosed><button type="button">Row</button></Collapse>,
        );
        const region = container.querySelector('#section')!;
        expect(region).toHaveAttribute('data-state', 'open');

        rerender(<Collapse open={false} id="section" unmountWhenClosed><button type="button">Row</button></Collapse>);
        expect(region).toHaveAttribute('data-state', 'closing');
        expect(region).toHaveAttribute('inert');
        expect(screen.queryByText('Row')).not.toBeNull();

        // Collapse runs for MOTION_DURATION.collapse (320ms) plus a little settle slack.
        act(() => { vi.advanceTimersByTime(360); });
        expect(region).toHaveAttribute('hidden');
        expect(region).toHaveClass('hidden');
        expect(screen.queryByText('Row')).toBeNull();
    });

    it('hides immediately when animations are off', () => {
        setMotionPreference('off');
        const { container, rerender } = render(<Collapse open id="section"><span>Row</span></Collapse>);
        rerender(<Collapse open={false} id="section"><span>Row</span></Collapse>);
        expect(container.querySelector('#section')).toHaveAttribute('hidden');
    });
});
