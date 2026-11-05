import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PanelResizeHandle } from './PanelResizeHandle';

const setup = (height = 600) => {
    const resize = vi.fn().mockImplementation(async (h: number | null) => h ?? 600);
    render(<PanelResizeHandle label="Resize panel" resize={resize} getHeight={() => height} />);
    return { resize, handle: screen.getByRole('separator', { name: 'Resize panel' }) };
};

describe('PanelResizeHandle', () => {
    it('is an accessible horizontal separator', () => {
        const { handle } = setup();
        expect(handle).toHaveAttribute('aria-orientation', 'horizontal');
        expect(handle).toHaveAttribute('tabindex', '0');
    });

    it('grows and shrinks with the arrow keys, and Shift takes bigger steps', () => {
        const { handle, resize } = setup(600);
        fireEvent.keyDown(handle, { key: 'ArrowDown' });
        expect(resize).toHaveBeenLastCalledWith(624, true);
        fireEvent.keyDown(handle, { key: 'ArrowUp' });
        expect(resize).toHaveBeenLastCalledWith(576, true);
        fireEvent.keyDown(handle, { key: 'ArrowDown', shiftKey: true });
        expect(resize).toHaveBeenLastCalledWith(696, true);
    });

    it('resets to the default on double-click', () => {
        const { handle, resize } = setup(700);
        fireEvent.doubleClick(handle);
        expect(resize).toHaveBeenLastCalledWith(null, true);
    });

    it('resizes live while dragging and saves on release', async () => {
        vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 1; });
        const { handle, resize } = setup(600);
        const ev = (type: string, y: number) => {
            const e = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, screenY: y });
            Object.defineProperty(e, 'pointerId', { value: 1 });
            return e;
        };
        await act(async () => {
            handle.dispatchEvent(ev('pointerdown', 100));
            handle.dispatchEvent(ev('pointermove', 180));
        });
        expect(resize).toHaveBeenCalledWith(680, false);
        await act(async () => { handle.dispatchEvent(ev('pointerup', 200)); });
        expect(resize).toHaveBeenLastCalledWith(700, true);
        vi.unstubAllGlobals();
    });
});
