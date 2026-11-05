import { StrictMode, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

import { Dialog } from './Dialog';
import { installMotionPreference, resetMotionPreferenceForTests, setMotionPreference } from '../../lib/motion';

type Finish = () => void;
let finishers: Finish[] = [];

function stubWebAnimations() {
    finishers = [];
    Object.defineProperty(Element.prototype, 'animate', {
        configurable: true,
        writable: true,
        value: vi.fn(() => {
            let finish: Finish = () => undefined;
            const finished = new Promise<void>((resolve) => { finish = resolve; });
            finishers.push(finish);
            return { finished, cancel: vi.fn() };
        }),
    });
}

function Harness() {
    const [open, setOpen] = useState(true);
    return (
        <>
            <button type="button" onClick={() => setOpen(true)}>Open</button>
            {open && (
                <Dialog onClose={() => setOpen(false)} label="Motion dialog">
                    <input name="field" defaultValue="kept" />
                    <button type="button" onClick={() => setOpen(false)}>Close</button>
                </Dialog>
            )}
        </>
    );
}

const ghosts = () => document.body.querySelectorAll('[data-exit-ghost]');

const flushMicrotasks = () => act(async () => { await Promise.resolve(); });

describe('Dialog exit motion', () => {
    beforeEach(() => {
        localStorage.clear();
        resetMotionPreferenceForTests();
        installMotionPreference();
        stubWebAnimations();
    });

    afterEach(() => {
        vi.useRealTimers();
        resetMotionPreferenceForTests();
        Reflect.deleteProperty(Element.prototype, 'animate');
        document.body.querySelectorAll('[data-exit-ghost]').forEach((node) => node.remove());
    });

    it('plays the enter animation classes on the backdrop and panel', () => {
        render(<Harness />);
        const panel = screen.getByRole('dialog');
        expect(panel).toHaveClass('motion-dialog');
        expect(panel.parentElement).toHaveClass('motion-overlay');
    });

    it('unmounts the dialog at once but keeps an inert ghost until the exit animation finishes', async () => {
        render(<Harness />);
        fireEvent.click(screen.getByRole('button', { name: 'Close' }));
        expect(screen.queryByRole('dialog')).toBeNull();

        await flushMicrotasks();
        const [ghost] = Array.from(ghosts());
        expect(ghost).toBeDefined();
        expect(ghost).toHaveAttribute('aria-hidden', 'true');
        expect(ghost).toHaveAttribute('inert');
        expect(ghost.querySelector('[role="dialog"]')).toBeNull();
        expect(ghost.querySelector('[name]')).toBeNull();
        expect(Element.prototype.animate).toHaveBeenCalled();

        await act(async () => {
            finishers.forEach((finish) => finish());
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(ghosts()).toHaveLength(0);
    });

    it('removes the ghost by a timeout even if the animation never settles', async () => {
        vi.useFakeTimers();
        render(<Harness />);
        fireEvent.click(screen.getByRole('button', { name: 'Close' }));
        await flushMicrotasks();
        expect(ghosts()).toHaveLength(1);
        act(() => { vi.advanceTimersByTime(400); });
        expect(ghosts()).toHaveLength(0);
    });

    it('closes instantly with no ghost when animations are off', async () => {
        setMotionPreference('off');
        render(<Harness />);
        fireEvent.click(screen.getByRole('button', { name: 'Close' }));
        await flushMicrotasks();
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(ghosts()).toHaveLength(0);
        expect(Element.prototype.animate).not.toHaveBeenCalled();
    });

    it('does not leave a ghost behind for StrictMode effect replays while open', async () => {
        render(<StrictMode><Harness /></StrictMode>);
        await flushMicrotasks();
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(ghosts()).toHaveLength(0);
    });

    it('still closes on Escape and can reopen', async () => {
        render(<Harness />);
        const opener = screen.getByRole('button', { name: 'Open' });
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
        expect(screen.queryByRole('dialog')).toBeNull();
        fireEvent.click(opener);
        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
});
