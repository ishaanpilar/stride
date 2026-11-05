import type { Ref } from 'react';
import type { PanelDragGhost as GhostInfo } from './usePanelReorder';

/** The lifted copy of the row that follows the pointer while dragging (the original stays dimmed in the list). */
export function PanelDragGhost({ ghost, ghostRef }: { ghost: GhostInfo; ghostRef: Ref<HTMLDivElement> }) {
    return (
        <div
            ref={ghostRef}
            aria-hidden="true"
            data-testid="menubar-drag-ghost"
            className="pointer-events-none fixed left-0 top-0 z-50 flex items-start gap-2.5 rounded-card bg-card px-3 py-2.5 shadow-soft motion-safe:scale-[1.015]"
            style={{ width: ghost.width, minHeight: ghost.height, left: ghost.left, transform: `translateY(${Math.round(ghost.top)}px)` }}
        >
            <span className="mt-px h-[18px] w-[18px] shrink-0 rounded-full border-[1.5px] border-muted-foreground/50" />
            <span className="line-clamp-2 min-w-0 flex-1 text-sm font-semibold leading-snug text-foreground">{ghost.title}</span>
        </div>
    );
}
