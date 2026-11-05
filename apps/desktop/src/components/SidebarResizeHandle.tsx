import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { cn } from '../lib/utils';
import {
    SIDEBAR_MIN_WIDTH,
    clampSidebarWidth,
    getSidebarMaxWidth,
    getSidebarWidthForKey,
} from '../store/sidebar-width-store';

interface SidebarResizeHandleProps {
    /** The element whose width follows the drag (the sidebar). */
    targetRef: RefObject<HTMLElement | null>;
    /** Current effective width (already clamped to the window). */
    width: number;
    windowWidth?: number;
    label: string;
    onCommit: (width: number) => void;
    onReset: () => void;
}

type DragState = { pointerId: number; startX: number; startWidth: number; latest: number; frame: number | null };

/**
 * Vertical separator on the sidebar's right edge. While dragging, the width is written straight to
 * the sidebar's style once per animation frame (no React re-render per pointer move); the final
 * width is committed (and persisted) on release. Double-click resets; arrows resize (Shift = larger).
 */
export function SidebarResizeHandle({ targetRef, width, windowWidth, label, onCommit, onReset }: SidebarResizeHandleProps) {
    const dragRef = useRef<DragState | null>(null);
    const handleRef = useRef<HTMLDivElement | null>(null);
    const max = getSidebarMaxWidth(windowWidth);

    const applyWidth = (next: number) => {
        const target = targetRef.current;
        if (target) target.style.width = `${next}px`;
        handleRef.current?.setAttribute('aria-valuenow', String(next));
    };

    const endDrag = (commit: boolean) => {
        const drag = dragRef.current;
        if (!drag) return;
        dragRef.current = null;
        if (drag.frame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(drag.frame);
        targetRef.current?.removeAttribute('data-resizing');
        document.documentElement.classList.remove('sidebar-resizing');
        if (commit) {
            applyWidth(drag.latest);
            onCommit(drag.latest);
        } else {
            applyWidth(drag.startWidth);
        }
    };

    useEffect(() => () => {
        // Unmounted mid-drag: drop the global cursor class.
        if (dragRef.current) document.documentElement.classList.remove('sidebar-resizing');
    }, []);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && dragRef.current) {
                event.preventDefault();
                endDrag(false);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    });

    const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width, latest: width, frame: null };
        targetRef.current?.setAttribute('data-resizing', 'true');
        document.documentElement.classList.add('sidebar-resizing');
    };

    const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        drag.latest = clampSidebarWidth(drag.startWidth + (event.clientX - drag.startX), windowWidth);
        if (typeof requestAnimationFrame !== 'function') {
            applyWidth(drag.latest);
            return;
        }
        if (drag.frame !== null) return;
        drag.frame = requestAnimationFrame(() => {
            const current = dragRef.current;
            if (!current) return;
            current.frame = null;
            applyWidth(current.latest);
        });
    };

    const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        endDrag(true);
    };

    const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            onReset();
            return;
        }
        const next = getSidebarWidthForKey(width, event.key, event.shiftKey, windowWidth);
        if (next === null) return;
        event.preventDefault();
        if (next !== width) onCommit(next);
    };

    return (
        <div
            ref={handleRef}
            role="separator"
            tabIndex={0}
            aria-orientation="vertical"
            aria-label={label}
            aria-valuemin={SIDEBAR_MIN_WIDTH}
            aria-valuemax={max}
            aria-valuenow={width}
            title={label}
            data-sidebar-resize-handle
            className={cn(
                'group absolute bottom-0 right-0 top-[var(--titlebar-inset)] z-20 flex w-2 cursor-col-resize touch-none select-none justify-end outline-none',
            )}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => endDrag(true)}
            onLostPointerCapture={() => endDrag(true)}
            onDoubleClick={onReset}
            onKeyDown={onKeyDown}
        >
            <span
                aria-hidden="true"
                className="h-full w-[2px] bg-transparent transition-colors duration-150 group-hover:bg-primary/50 group-focus-visible:bg-primary group-active:bg-primary/70 motion-reduce:transition-none"
            />
        </div>
    );
}
