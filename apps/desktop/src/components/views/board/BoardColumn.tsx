import { useDroppable } from '@dnd-kit/core';
import { SortableContext } from '@dnd-kit/sortable';
import React from 'react';
import { MoreHorizontal, Plus } from 'lucide-react';
import type { Task, TaskStatus } from '@stride/core';
import { cn } from '../../../lib/utils';
import { LIST_END_GAP } from '../list/list-toolbar';
import type { BoardKeyboardDirection } from '../board-view-dnd';
import { BoardCard, type BoardCardProject } from './BoardCard';
import { BoardComposer } from './BoardComposer';

const STATUS_DOT: Record<TaskStatus, string> = {
    inbox: 'bg-[hsl(var(--status-inbox))]',
    next: 'bg-[hsl(var(--status-next))]',
    waiting: 'bg-[hsl(var(--status-waiting))]',
    someday: 'bg-[hsl(var(--status-someday))]',
    reference: 'bg-[hsl(var(--status-reference))]',
    done: 'bg-[hsl(var(--status-done))]',
    archived: 'bg-[hsl(var(--status-archived))]',
};

/** Cards never displace each other while dragging: the insertion line shows where the card will land. */
const noDisplacementStrategy = () => null;

export type BoardDropIndicator = { columnId: TaskStatus; taskId: string | null; position: 'before' | 'after' } | null;
export type BoardComposerState = { status: TaskStatus; position: 'top' | 'bottom' } | null;

export type BoardColumnLabels = {
    addCard: string;
    addCardSubmit: string;
    cardPlaceholder: string;
    cancel: string;
    columnMenu: string;
    cardMenu: string;
    expand: string;
    showOlder: string;
    hideOlder: string;
    drag: string;
};

type BoardColumnProps = {
    id: TaskStatus;
    label: string;
    tasks: Task[];
    /** Total in the column, including cards hidden by the Done window. */
    totalCount: number;
    olderCount?: number;
    showOlder?: boolean;
    onToggleOlder?: () => void;
    emptyState: { body: string };
    labels: BoardColumnLabels;
    compact?: boolean;
    collapsed?: boolean;
    showPriority: boolean;
    projectById: Map<string, BoardCardProject>;
    dropIndicator: BoardDropIndicator;
    composer: BoardComposerState;
    tabbableId: string | null;
    t: (key: string) => string;
    onOpenComposer: (status: TaskStatus, position: 'top' | 'bottom') => void;
    onCloseComposer: () => void;
    onSubmitCard: (status: TaskStatus, title: string, position: 'top' | 'bottom') => void | Promise<void>;
    onOpenColumnMenu: (status: TaskStatus, anchor: { x: number; y: number; width: number; height: number }, trigger: HTMLElement) => void;
    onExpand: (status: TaskStatus) => void;
    onToggleDone: (task: Task) => void;
    onKeyboardMove: (task: Task, direction: BoardKeyboardDirection, edge?: boolean) => void;
    onNavigate: (task: Task, direction: BoardKeyboardDirection) => void;
    onFocusCard: (task: Task) => void;
    onCardMenu: (task: Task, anchor: { x: number; y: number; width?: number; height?: number }, trigger: HTMLElement) => void;
    onColumnShortcut: (task: Task, key: 'collapse' | 'add') => void;
};

export function BoardColumn({
    id,
    label,
    tasks,
    totalCount,
    olderCount = 0,
    showOlder,
    onToggleOlder,
    emptyState,
    labels,
    compact,
    collapsed,
    showPriority,
    projectById,
    dropIndicator,
    composer,
    tabbableId,
    t,
    onOpenComposer,
    onCloseComposer,
    onSubmitCard,
    onOpenColumnMenu,
    onExpand,
    onToggleDone,
    onKeyboardMove,
    onNavigate,
    onFocusCard,
    onCardMenu,
    onColumnShortcut,
}: BoardColumnProps) {
    const { setNodeRef, isOver } = useDroppable({ id });
    const scrollerRef = React.useRef<HTMLDivElement | null>(null);
    const indicator = dropIndicator && dropIndicator.columnId === id ? dropIndicator : null;
    const emptyActive = tasks.length === 0 && (isOver || Boolean(indicator));
    const activeComposer = composer && composer.status === id ? composer.position : null;
    const previousCollapsed = React.useRef(collapsed);
    const toggledThisMount = React.useRef(false);
    if (previousCollapsed.current !== collapsed) {
        previousCollapsed.current = collapsed;
        toggledThisMount.current = true;
    }
    const toggleMotionClass = toggledThisMount.current ? 'motion-expand-in' : undefined;

    if (collapsed) {
        return (
            <section
                key="collapsed"
                ref={setNodeRef}
                data-board-column={id}
                data-board-collapsed="true"
                aria-label={label}
                className={cn(
                    'flex max-h-full w-12 flex-none flex-col items-center rounded-card bg-well shadow-soft-inset',
                    toggleMotionClass,
                    'transition-colors duration-[350ms] ease-[cubic-bezier(0.15,1,0.3,1)] motion-reduce:transition-none',
                    isOver && 'bg-accent-soft',
                )}
            >
                <button
                    type="button"
                    onClick={() => onExpand(id)}
                    aria-label={`${labels.expand}: ${label}`}
                    title={labels.expand}
                    className="flex h-full min-h-[120px] w-full flex-col items-center gap-3 rounded-card px-1 py-3 text-[13px] font-semibold text-foreground hover:bg-card/60 focus-ring"
                >
                    <span className="text-xs font-medium tabular-nums text-muted-foreground">{totalCount}</span>
                    <span className={cn('h-2 w-2 shrink-0 rounded-full', STATUS_DOT[id])} aria-hidden="true" />
                    <span className="min-h-0 truncate [writing-mode:vertical-rl]">{label}</span>
                </button>
            </section>
        );
    }

    const handleSubmit = async (title: string) => {
        await onSubmitCard(id, title, activeComposer ?? 'bottom');
        window.requestAnimationFrame(() => {
            const scroller = scrollerRef.current;
            if (scroller) scroller.scrollTop = activeComposer === 'top' ? 0 : scroller.scrollHeight;
        });
    };
    const composerNode = (
        <BoardComposer
            placeholder={labels.cardPlaceholder}
            addLabel={labels.addCardSubmit}
            cancelLabel={labels.cancel}
            compact={compact}
            onSubmit={handleSubmit}
            onClose={onCloseComposer}
        />
    );

    return (
        <section
            key="expanded"
            ref={setNodeRef}
            data-board-column={id}
            aria-label={label}
            className={cn(
                'flex max-h-full w-[clamp(248px,calc((100cqw_-_2.75rem)/2),288px)] min-w-[248px] max-w-[320px] flex-none snap-start flex-col rounded-card bg-well shadow-soft-inset',
                toggleMotionClass,
                compact ? 'p-1.5' : 'p-2',
            )}
        >
            <header className="flex shrink-0 items-center gap-1 px-2 pb-2 pt-1">
                <h3 className="m-0 flex min-w-0 flex-1 items-center gap-2 text-[13px] font-semibold text-foreground">
                    <span className={cn('h-2 w-2 shrink-0 rounded-full', STATUS_DOT[id])} aria-hidden="true" />
                    <span className="min-w-0 truncate">{label}</span>
                    <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">{totalCount}</span>
                </h3>
                <button
                    type="button"
                    onClick={() => onOpenComposer(id, 'top')}
                    aria-label={`${labels.addCard}: ${label}`}
                    title={labels.addCard}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-muted-foreground hover:bg-card hover:text-foreground focus-ring"
                >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                    type="button"
                    data-board-column-menu={id}
                    aria-haspopup="menu"
                    onClick={(event) => {
                        const rect = event.currentTarget.getBoundingClientRect();
                        onOpenColumnMenu(id, { x: rect.left, y: rect.top, width: rect.width, height: rect.height }, event.currentTarget);
                    }}
                    aria-label={`${labels.columnMenu}: ${label}`}
                    title={labels.columnMenu}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-muted-foreground hover:bg-card hover:text-foreground focus-ring"
                >
                    <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                </button>
            </header>
            <div
                ref={scrollerRef}
                className={cn(
                    'min-h-[56px] flex-1 overflow-y-auto overflow-x-hidden rounded-control px-1 focus-ring',
                    '[scrollbar-width:thin] [scrollbar-color:transparent_transparent] hover:[scrollbar-color:hsl(var(--border))_transparent]',
                )}
                tabIndex={tasks.length === 0 ? 0 : undefined}
                role="list"
                aria-label={`${label} tasks list`}
            >
                <div data-list-end className={cn('flex flex-col gap-2', LIST_END_GAP)}>
                    {activeComposer === 'top' ? composerNode : null}
                    {tasks.length === 0 ? (
                        activeComposer ? null : (
                            <div
                                data-board-empty
                                className={cn(
                                    'flex min-h-[56px] items-center justify-center rounded-card border-2 border-dashed px-3 py-3 text-center text-[13px] text-muted-foreground',
                                    'transition-colors duration-[350ms] ease-[cubic-bezier(0.15,1,0.3,1)] motion-reduce:transition-none',
                                    emptyActive ? 'border-accent-fill bg-accent-soft' : 'border-border',
                                )}
                            >
                                {emptyState.body}
                            </div>
                        )
                    ) : (
                        <SortableContext items={tasks.map((task) => task.id)} strategy={noDisplacementStrategy}>
                            {tasks.map((task) => (
                                <BoardCard
                                    key={task.id}
                                    task={task}
                                    project={task.projectId ? projectById.get(task.projectId) : undefined}
                                    showPriority={showPriority}
                                    t={t}
                                    compact={compact}
                                    dragLabel={labels.drag}
                                    menuLabel={labels.cardMenu}
                                    tabbable={tabbableId === task.id}
                                    dropLine={indicator?.taskId === task.id ? indicator.position : null}
                                    onToggleDone={onToggleDone}
                                    onKeyboardMove={onKeyboardMove}
                                    onNavigate={onNavigate}
                                    onFocusCard={onFocusCard}
                                    onOpenMenu={onCardMenu}
                                    onContextMenu={onCardMenu}
                                    onColumnShortcut={onColumnShortcut}
                                />
                            ))}
                        </SortableContext>
                    )}
                    {olderCount > 0 && onToggleOlder ? (
                        <button
                            type="button"
                            data-board-show-older
                            aria-expanded={Boolean(showOlder)}
                            onClick={onToggleOlder}
                            className="flex h-8 w-full items-center justify-center rounded-control text-[13px] font-medium text-muted-foreground hover:bg-card hover:text-foreground focus-ring"
                        >
                            {showOlder ? labels.hideOlder : labels.showOlder}
                        </button>
                    ) : null}
                    {activeComposer === 'bottom' ? composerNode : null}
                </div>
            </div>
            {activeComposer === 'bottom' ? null : (
                <button
                    type="button"
                    onClick={() => onOpenComposer(id, 'bottom')}
                    className="mt-1 flex h-8 w-full shrink-0 items-center gap-1.5 rounded-control px-2 text-[13px] font-medium text-muted-foreground hover:bg-card hover:text-foreground focus-ring"
                >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    {labels.addCard}
                </button>
            )}
        </section>
    );
}
