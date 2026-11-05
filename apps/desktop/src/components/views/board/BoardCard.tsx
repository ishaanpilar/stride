import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { SORTABLE_TRANSITION } from '../../../lib/motion';
import { CSS } from '@dnd-kit/utilities';
import { Check, Circle, MoreHorizontal } from 'lucide-react';
import { isTaskCompleted, safeFormatDate, safeParseDate, tFallback } from '@stride/core';
import type { Task } from '@stride/core';
import { TaskItem } from '../../TaskItem';
import { FocusStarIcon } from '../../FocusStarIcon';
import { Pill, type PillTone } from '../../ui/Pill';
import { cn } from '../../../lib/utils';
import { useUiStore } from '../../../store/ui-store';
import type { BoardKeyboardDirection } from '../board-view-dnd';

export type BoardCardProject = { title: string; color?: string };

type BoardCardBodyProps = {
    task: Task;
    project?: BoardCardProject;
    showPriority: boolean;
    t: (key: string) => string;
    compact?: boolean;
    onToggleDone?: (task: Task) => void;
    /** Hover/focus '...' button. Sits in the title row, never over the title text. */
    onOpenMenu?: (task: Task, anchor: { x: number; y: number; width: number; height: number }, trigger: HTMLElement) => void;
    menuLabel?: string;
};

const CHIP = 'h-5 px-2 text-[11px] leading-4';

function priorityTone(priority: Task['priority']): PillTone {
    if (priority === 'urgent' || priority === 'high') return 'danger';
    if (priority === 'medium') return 'warning';
    return 'neutral';
}

/** Presentational card: title (wraps, up to 3 lines), then one wrapping chip row. Nothing is absolutely positioned over the title. */
export function BoardCardBody({ task, project, showPriority, t, compact, onToggleDone, onOpenMenu, menuLabel }: BoardCardBodyProps) {
    const done = isTaskCompleted(task);
    const due = safeParseDate(task.dueDate);
    const overdue = !done && due ? due.getTime() < Date.now() && !isToday(due) : false;
    const tokens = [...(task.contexts ?? []), ...(task.tags ?? [])];
    const shownTokens = tokens.slice(0, 2);
    const extraTokens = tokens.length - shownTokens.length;
    const markDone = tFallback(t, 'task.markDone', 'Mark done');
    const reopen = tFallback(t, 'status.reopen', 'Reopen');
    const showFocusStar = task.isFocusedToday === true && task.status === 'next';

    return (
        <div className={cn('flex min-w-0 flex-col gap-2', compact ? 'p-2.5' : 'p-3')}>
            <div className="flex min-w-0 items-start gap-2">
                {onToggleDone ? (
                    <button
                        type="button"
                        onClick={(event) => { event.stopPropagation(); onToggleDone(task); }}
                        onPointerDown={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                        aria-label={done ? reopen : markDone}
                        title={done ? reopen : markDone}
                        className="mt-px inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-ring"
                    >
                        {done ? <Check className="h-4 w-4 text-success-text" aria-hidden="true" /> : <Circle className="h-4 w-4" aria-hidden="true" />}
                    </button>
                ) : null}
                <p
                    data-board-card-title
                    className={cn(
                        'm-0 min-w-0 flex-1 break-words text-[14px] font-semibold leading-5 [overflow-wrap:anywhere] line-clamp-3',
                        done && 'text-muted-foreground line-through',
                    )}
                >
                    {task.title}
                    {showFocusStar ? (
                        <FocusStarIcon
                            filled
                            aria-hidden="true"
                            data-focus-star-pinned
                            className="ms-1 inline-block h-3.5 w-3.5 shrink-0 align-[-2px]"
                        />
                    ) : null}
                </p>
                {onOpenMenu ? (
                    <button
                        type="button"
                        data-board-card-menu
                        aria-label={menuLabel ?? 'Card actions'}
                        aria-haspopup="menu"
                        title={menuLabel ?? 'Card actions'}
                        onClick={(event) => {
                            event.stopPropagation();
                            const rect = event.currentTarget.getBoundingClientRect();
                            onOpenMenu(task, { x: rect.left, y: rect.top, width: rect.width, height: rect.height }, event.currentTarget);
                        }}
                        onPointerDown={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                        className="-me-1 -mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-control text-muted-foreground opacity-0 transition-opacity hover:bg-well hover:text-foreground focus-visible:opacity-100 group-hover/card:opacity-100 group-focus-within/card:opacity-100 focus-ring motion-reduce:transition-none"
                    >
                        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                    </button>
                ) : null}
            </div>
            {(showPriority && task.priority) || project || due || shownTokens.length > 0 ? (
                <div data-board-card-chips className="flex min-w-0 flex-wrap items-center gap-1.5">
                    {showPriority && task.priority ? (
                        <Pill data-board-priority tone={priorityTone(task.priority)} className={CHIP}>
                            {t(`priority.${task.priority}`)}
                        </Pill>
                    ) : null}
                    {due ? (
                        <Pill tone={overdue ? 'danger' : 'neutral'} className={CHIP}>
                            {safeFormatDate(task.dueDate, 'MMM d')}
                        </Pill>
                    ) : null}
                    {project ? (
                        <Pill dot={project.color ?? true} className={cn(CHIP, 'min-w-0')} title={project.title}>
                            <span className="min-w-0 truncate">{project.title}</span>
                        </Pill>
                    ) : null}
                    {shownTokens.map((token) => (
                        <Pill key={token} className={cn(CHIP, 'min-w-0')} title={token}>
                            <span className="min-w-0 truncate">{token}</span>
                        </Pill>
                    ))}
                    {extraTokens > 0 ? <Pill className={CHIP}>{`+${extraTokens}`}</Pill> : null}
                </div>
            ) : null}
        </div>
    );
}

function isToday(date: Date): boolean {
    const now = new Date();
    return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
}

const CARD_SURFACE = 'relative block w-full min-w-0 max-w-full overflow-hidden rounded-card bg-card text-start text-foreground shadow-soft-sm';

type BoardCardProps = BoardCardBodyProps & {
    dragLabel: string;
    dropLine?: 'before' | 'after' | null;
    /** Roving tabindex: only the board's current card is a tab stop. */
    tabbable?: boolean;
    onKeyboardMove: (task: Task, direction: BoardKeyboardDirection, edge?: boolean) => void;
    onNavigate?: (task: Task, direction: BoardKeyboardDirection) => void;
    onFocusCard?: (task: Task) => void;
    onContextMenu?: (task: Task, anchor: { x: number; y: number }, trigger: HTMLElement) => void;
    onColumnShortcut?: (task: Task, key: 'collapse' | 'add') => void;
};

const ARROW_DIRECTION: Record<string, BoardKeyboardDirection | undefined> = {
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowUp: 'up',
    ArrowDown: 'down',
};

/** Whole card is the drag target (Trello style). Enter opens the task, arrows move focus, Alt+Arrow moves the card. */
export function BoardCard({
    task, dragLabel, dropLine, tabbable = true, onKeyboardMove, onNavigate, onFocusCard, onContextMenu, onColumnShortcut, ...body
}: BoardCardProps) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        transition: SORTABLE_TRANSITION,
        id: task.id,
        data: { task },
    });
    const editingTaskId = useUiStore((state) => state.editingTaskId);
    const setEditingTaskId = useUiStore((state) => state.setEditingTaskId);

    const open = () => setEditingTaskId(task.id);
    const sortableKeyDown = (listeners as { onKeyDown?: (event: React.KeyboardEvent) => void } | undefined)?.onKeyDown;
    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.target === event.currentTarget) {
            const direction = ARROW_DIRECTION[event.key];
            if (direction && event.altKey) {
                event.preventDefault();
                event.stopPropagation();
                onKeyboardMove(task, direction, event.shiftKey);
                return;
            }
            if (direction && !event.metaKey && !event.ctrlKey && onNavigate) {
                event.preventDefault();
                onNavigate(task, direction);
                return;
            }
            if (event.key === 'Enter') {
                event.preventDefault();
                open();
                return;
            }
            if ((event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) && onContextMenu) {
                event.preventDefault();
                const rect = event.currentTarget.getBoundingClientRect();
                onContextMenu(task, { x: rect.left + 16, y: rect.top + 16 }, event.currentTarget);
                return;
            }
            if (event.key === '\\' && onColumnShortcut) {
                event.preventDefault();
                onColumnShortcut(task, 'collapse');
                return;
            }
            if ((event.key === 'n' || event.key === 'N') && !event.metaKey && !event.ctrlKey && onColumnShortcut) {
                event.preventDefault();
                onColumnShortcut(task, 'add');
                return;
            }
        }
        sortableKeyDown?.(event);
    };

    const style = transform || transition ? { transform: CSS.Transform.toString(transform), transition } : undefined;

    return (
        <div
            ref={setNodeRef}
            style={style}
            role="listitem"
            data-board-card-id={task.id}
            className="group/card relative min-w-0"
        >
            {dropLine === 'before' ? <DropLine position="before" /> : null}
            <div
                {...attributes}
                {...listeners}
                role="group"
                aria-label={task.title}
                aria-roledescription={dragLabel}
                data-board-card
                tabIndex={tabbable ? 0 : -1}
                onKeyDown={handleKeyDown}
                onFocus={(event) => { if (event.target === event.currentTarget) onFocusCard?.(task); }}
                onClick={open}
                onContextMenu={(event) => {
                    if (!onContextMenu) return;
                    event.preventDefault();
                    onContextMenu(task, { x: event.clientX, y: event.clientY }, event.currentTarget);
                }}
                className={cn(
                    CARD_SURFACE,
                    'cursor-grab select-none active:cursor-grabbing focus-ring',
                    'transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-px hover:shadow-soft',
                    'motion-reduce:transition-none motion-reduce:hover:translate-y-0',
                    isDragging && 'opacity-40',
                    isTaskCompleted(task) && 'opacity-80',
                )}
            >
                <BoardCardBody task={task} {...body} />
            </div>
            {dropLine === 'after' ? <DropLine position="after" /> : null}
            {editingTaskId === task.id ? (
                <div className="h-0 w-0 overflow-hidden" data-board-editor-host>
                    <TaskItem
                        task={task}
                        showStatusSelect={false}
                        showProjectBadgeInActions={false}
                        actionsOverlay
                        showHoverHint={false}
                        enableDoubleClickEdit
                        editorPresentation="modal"
                    />
                </div>
            ) : null}
        </div>
    );
}

/** 2px line centred in the 8px gap between cards, with an 8px terminal dot (Atlassian drag-and-drop spec). */
export function DropLine({ position }: { position: 'before' | 'after' }) {
    return (
        <span
            aria-hidden="true"
            data-board-drop-line={position}
            className={cn(
                'pointer-events-none absolute inset-x-0 z-10 flex h-2 items-center',
                position === 'before' ? '-top-2' : '-bottom-2',
            )}
        >
            <span className="h-2 w-2 shrink-0 rounded-full border-2 border-accent-fill bg-card" />
            <span className="h-[2px] flex-1 bg-accent-fill" />
        </span>
    );
}

/** Lifted drag preview: slight rotation and the raised soft shadow. Width matches the real card. */
export function BoardCardOverlay({ width, ...props }: BoardCardBodyProps & { width?: number }) {
    return (
        <div
            data-board-drag-overlay
            style={{ width: width && width > 0 ? width : 264 }}
            className={cn(CARD_SURFACE, 'max-h-[280px] cursor-grabbing rotate-2 shadow-soft motion-reduce:rotate-0')}
        >
            <BoardCardBody {...props} onToggleDone={undefined} onOpenMenu={undefined} />
        </div>
    );
}
