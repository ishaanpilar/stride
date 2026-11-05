import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { invokeNative } from '../../lib/tauri-invoke';

export const PANEL_MIN_HEIGHT = 420;
export const PANEL_KEY_STEP = 24;
export const PANEL_KEY_STEP_LARGE = 96;

interface PanelResizeHandleProps {
    label: string;
    /** Test seam; defaults to the native `menubar_panel_resize` command. */
    resize?: (height: number | null, finish: boolean) => Promise<number | void>;
    getHeight?: () => number;
}

const nativeResize = (height: number | null, finish: boolean) =>
    invokeNative<number>('menubar_panel_resize', { height, finish });

/**
 * Invisible 8px grab strip on the panel's bottom edge. Dragging asks Rust to resize the window
 * (top edge stays anchored; Rust clamps, saves on release and keeps blur-hide from firing).
 * Double-click resets; Arrow Up/Down change the height by 24px (96px with Shift).
 */
export function PanelResizeHandle({ label, resize = nativeResize, getHeight = () => window.innerHeight }: PanelResizeHandleProps) {
    const [height, setHeight] = useState(() => getHeight());
    const drag = useRef<{ startY: number; startHeight: number } | null>(null);
    const frame = useRef<number | null>(null);
    const pending = useRef<number | null>(null);

    const apply = useCallback((next: number | null, finish: boolean) => {
        void Promise.resolve(resize(next, finish)).then((applied) => {
            if (typeof applied === 'number') setHeight(applied);
        }).catch(() => undefined);
    }, [resize]);

    useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);

    const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        drag.current = { startY: event.screenY, startHeight: getHeight() };
    };
    const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
        const current = drag.current;
        if (!current) return;
        pending.current = current.startHeight + (event.screenY - current.startY);
        if (frame.current !== null) return;
        frame.current = requestAnimationFrame(() => {
            frame.current = null;
            if (pending.current !== null) apply(pending.current, false);
        });
    };
    const endDrag = (event: PointerEvent<HTMLDivElement>) => {
        const current = drag.current;
        if (!current) return;
        drag.current = null;
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        apply(current.startHeight + (event.screenY - current.startY), true);
    };
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        event.stopPropagation();
        const step = event.shiftKey ? PANEL_KEY_STEP_LARGE : PANEL_KEY_STEP;
        apply(getHeight() + (event.key === 'ArrowDown' ? step : -step), true);
    };

    return (
        <div
            role="separator"
            aria-orientation="horizontal"
            aria-label={label}
            aria-valuemin={PANEL_MIN_HEIGHT}
            aria-valuenow={Math.round(height)}
            tabIndex={0}
            data-testid="panel-resize-handle"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onDoubleClick={() => apply(null, true)}
            onKeyDown={onKeyDown}
            className="absolute inset-x-3 bottom-0 z-30 h-2 cursor-row-resize rounded-full focus:outline-none focus-visible:bg-primary/30"
        />
    );
}
