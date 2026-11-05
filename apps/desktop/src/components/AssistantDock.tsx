import { useCallback, useEffect, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { cn } from '../lib/utils';
import { usePresence } from '../hooks/usePresence';
import { ExitGhost } from './ui/ExitGhost';
import { AssistantPanel } from './views/assistant/AssistantPanel';
import {
    ASSISTANT_DOCK_BREAKPOINT_PX,
    ASSISTANT_DOCK_MAX_WIDTH,
    ASSISTANT_DOCK_MIN_WIDTH,
    useAssistantDockStore,
} from '../store/assistant-dock-store';

/** True when the window is narrower than the dock breakpoint (dock becomes an overlay drawer). */
export function useAssistantNarrow(): boolean {
    const query = `(max-width: ${ASSISTANT_DOCK_BREAKPOINT_PX - 1}px)`;
    const [narrow, setNarrow] = useState(() => (
        typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches
    ));
    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
        const mq = window.matchMedia(query);
        const update = () => setNarrow(mq.matches);
        update();
        mq.addEventListener?.('change', update);
        return () => mq.removeEventListener?.('change', update);
    }, [query]);
    return narrow;
}

const DOCK_MOTION_MS = 260;

interface AssistantDockProps {
    narrow: boolean;
    /** The dock is the element at the window top edge (macOS overlay title bar). */
    padForTitlebar: boolean;
    onOpenAiSettings?: () => void;
}

export function AssistantDock({ narrow, padForTitlebar, onOpenAiSettings }: AssistantDockProps) {
    const open = useAssistantDockStore((s) => s.open);
    const drawerOpen = useAssistantDockStore((s) => s.drawerOpen);
    const width = useAssistantDockStore((s) => s.width);
    const setWidth = useAssistantDockStore((s) => s.setWidth);
    const setOpen = useAssistantDockStore((s) => s.setOpen);
    const setDrawerOpen = useAssistantDockStore((s) => s.setDrawerOpen);

    const visible = narrow ? drawerOpen : open;
    const dock = usePresence(!narrow && open, DOCK_MOTION_MS);
    const close = useCallback(() => (narrow ? setDrawerOpen(false) : setOpen(false)), [narrow, setDrawerOpen, setOpen]);

    useEffect(() => {
        if (!narrow || !drawerOpen) return;
        const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setDrawerOpen(false); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [narrow, drawerOpen, setDrawerOpen]);

    const resizeFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
        setWidth(window.innerWidth - event.clientX);
    };
    const onHandleKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'ArrowLeft') { event.preventDefault(); setWidth(width + 16); }
        else if (event.key === 'ArrowRight') { event.preventDefault(); setWidth(width - 16); }
    };

    if (narrow ? !visible : !dock.mounted) return null;

    const panel = (
        <AssistantPanel variant="dock" padForTitlebar={padForTitlebar} onClose={close} onOpenAiSettings={onOpenAiSettings} />
    );

    if (narrow) {
        return (
            <div className="fixed inset-0 z-40" data-testid="assistant-drawer">
                <ExitGhost preset="sheetRight" />
                <div className="motion-overlay absolute inset-0 bg-black/30" onClick={close} aria-hidden="true" />
                <aside
                    aria-label="Assistant"
                    data-exit-sheet
                    className="motion-sheet-right absolute inset-y-0 right-0 flex w-[min(380px,100vw)] flex-col bg-background shadow-soft"
                >
                    {panel}
                </aside>
            </div>
        );
    }

    const dockCollapsed = dock.state === 'entering' || dock.state === 'closing';
    return (
        <aside
            aria-label="Assistant"
            data-testid="assistant-dock"
            data-assistant-dock
            data-state={dock.state}
            aria-hidden={dock.state === 'closing' ? true : undefined}
            inert={dock.state === 'closing' ? true : undefined}
            className="motion-dock relative flex h-full min-h-0 shrink-0 flex-col bg-sidebar/60 shadow-soft-sm"
            style={{ width: dockCollapsed ? 0 : width }}
        >
            <div
                role="separator"
                tabIndex={0}
                aria-orientation="vertical"
                aria-label="Resize assistant"
                aria-valuemin={ASSISTANT_DOCK_MIN_WIDTH}
                aria-valuemax={ASSISTANT_DOCK_MAX_WIDTH}
                aria-valuenow={width}
                title="Resize assistant"
                className={cn('absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize touch-none select-none outline-none', 'hover:bg-primary/20 focus-visible:bg-primary/30')}
                onKeyDown={onHandleKey}
                onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    event.preventDefault();
                    event.currentTarget.setPointerCapture?.(event.pointerId);
                    resizeFromPointer(event);
                }}
                onPointerMove={(event) => {
                    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) resizeFromPointer(event);
                }}
                onPointerUp={(event) => {
                    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                }}
            />
            {/* The panel is clipped to the dock's height so a long chat or a focused composer can never push the whole window up. */}
            <div className="flex min-h-0 flex-1 flex-col self-end overflow-hidden" style={{ width }}>{panel}</div>
        </aside>
    );
}
