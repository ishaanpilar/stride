import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { ArrowDown, ArrowUp, ChevronsUp, GripVertical, MoreHorizontal } from 'lucide-react';
import { hasTimeComponent, safeFormatDate, type DropPlacement, type Project, type Task } from '@stride/core';
import { cn } from '../../lib/utils';
import { REORDER_IGNORE_ATTR } from './usePanelReorder';

export type PanelMoveAction = 'top' | 'up' | 'down';

/** Present only for rows that can be moved (open rows of Today's focused tasks, Inbox and Next). */
export interface PanelRowReorder {
    groupKey: string;
    siblingIds: readonly string[];
    /** 1-based position among the movable rows of the group. */
    position: number;
    count: number;
}

export interface PanelRowReorderLabels {
    drag: string;
    moveToTop: string;
    moveUp: string;
    moveDown: string;
    moreActions: string;
}

export type PanelRowTone = 'overdue' | 'today' | 'default';

interface PanelTaskRowProps {
    task: Task;
    project?: Project;
    tone: PanelRowTone;
    completing: boolean;
    completeLabel: string;
    todayLabel: string;
    /** Translated priority name; shown only for high and urgent tasks (as text, never colour alone). */
    priorityLabel?: string;
    onComplete: (task: Task) => void;
    onOpen: (task: Task) => void;
    onRowKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>, task: Task) => void;
    reorder?: PanelRowReorder | null;
    reorderLabels?: PanelRowReorderLabels;
    /** This row is the one being dragged (dimmed to 40%). */
    dragging?: boolean;
    /** Drop line on this row's top or bottom edge while another row is dragged over it. */
    dropPlacement?: DropPlacement | null;
    onReorderPointerDown?: (event: ReactPointerEvent<HTMLElement>, task: Task, reorder: PanelRowReorder) => void;
    /** Returns true once right after a drag ended, so the trailing click does not open the task. */
    consumeSuppressedClick?: () => boolean;
    onMove?: (task: Task, action: PanelMoveAction) => void;
}

export function metaLabel(task: Task, tone: PanelRowTone, todayLabel: string): string {
    const value = task.dueDate ?? task.startTime;
    if (!value) return '';
    const timed = hasTimeComponent(value);
    if (tone === 'today') return timed ? safeFormatDate(value, 'p') : todayLabel;
    if (tone === 'overdue') return safeFormatDate(value, timed ? 'MMM d, p' : 'MMM d');
    return safeFormatDate(value, timed ? 'p' : 'MMM d');
}

function RowMenu({
    task, reorder, labels, anchor, onClose, onMove,
}: {
    task: Task;
    reorder: PanelRowReorder;
    labels: PanelRowReorderLabels;
    anchor: { x: number; y: number };
    onClose: (restoreFocus: boolean) => void;
    onMove: (task: Task, action: PanelMoveAction) => void;
}) {
    const menuRef = useRef<HTMLDivElement>(null);
    const atTop = reorder.position <= 1;
    const atBottom = reorder.position >= reorder.count;
    const items: Array<{ action: PanelMoveAction; label: string; icon: typeof ArrowUp; disabled: boolean }> = [
        { action: 'top', label: labels.moveToTop, icon: ChevronsUp, disabled: atTop },
        { action: 'up', label: labels.moveUp, icon: ArrowUp, disabled: atTop },
        { action: 'down', label: labels.moveDown, icon: ArrowDown, disabled: atBottom },
    ];

    useEffect(() => {
        const first = menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)');
        first?.focus();
        const onPointerDown = (event: PointerEvent) => {
            if (!menuRef.current?.contains(event.target as Node)) onClose(false);
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        return () => document.removeEventListener('pointerdown', onPointerDown, true);
    }, [onClose]);

    const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onClose(true);
            return;
        }
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        event.stopPropagation();
        const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
        if (buttons.length === 0) return;
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'ArrowDown' ? (index + 1) % buttons.length : (index - 1 + buttons.length) % buttons.length;
        buttons[next]?.focus();
    };

    return (
        <div
            ref={menuRef}
            role="menu"
            aria-label={labels.moreActions}
            data-testid="menubar-row-menu"
            {...{ [REORDER_IGNORE_ATTR]: '' }}
            onKeyDown={onKeyDown}
            className="absolute z-30 min-w-[148px] rounded-card bg-card p-1 shadow-soft"
            style={{ left: Math.max(4, anchor.x), top: anchor.y }}
        >
            {items.map(({ action, label, icon: Icon, disabled }) => (
                <button
                    key={action}
                    type="button"
                    role="menuitem"
                    disabled={disabled}
                    onClick={() => { onClose(true); onMove(task, action); }}
                    className="flex w-full items-center gap-2 rounded-control px-2.5 py-1.5 text-left text-xs font-medium text-foreground transition-colors hover:bg-accent-soft focus:bg-accent-soft disabled:opacity-40 disabled:hover:bg-transparent focus-ring"
                >
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                    {label}
                </button>
            ))}
        </div>
    );
}

export function PanelTaskRow({
    task, project, tone, completing, completeLabel, todayLabel, priorityLabel, onComplete, onOpen, onRowKeyDown,
    reorder, reorderLabels, dragging, dropPlacement, onReorderPointerDown, consumeSuppressedClick, onMove,
}: PanelTaskRowProps) {
    const canReorder = Boolean(reorder && reorderLabels && onMove) && task.status !== 'done';
    const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
    const rowRef = useRef<HTMLLIElement>(null);
    const moreRef = useRef<HTMLButtonElement>(null);
    const closeMenu = (restoreFocus: boolean) => {
        setMenu(null);
        if (restoreFocus) rowRef.current?.querySelector<HTMLElement>('[data-row-main]')?.focus();
    };
    const openMenuAt = (clientX: number, clientY: number) => {
        const rect = rowRef.current?.getBoundingClientRect();
        if (!rect) return;
        setMenu({ x: Math.min(clientX - rect.left, Math.max(4, rect.width - 156)), y: clientY - rect.top });
    };
    const onContextMenu = (event: ReactMouseEvent<HTMLLIElement>) => {
        if (!canReorder) return;
        event.preventDefault();
        openMenuAt(event.clientX, event.clientY);
    };
    const onMoreClick = () => {
        if (menu) { closeMenu(false); return; }
        const rect = rowRef.current?.getBoundingClientRect();
        const more = moreRef.current?.getBoundingClientRect();
        if (rect && more) setMenu({ x: Math.max(4, more.right - rect.left - 148), y: more.bottom - rect.top + 2 });
    };
    const meta = metaLabel(task, tone, todayLabel);
    const projectColor = project ? (project.colorOverride || project.color) : undefined;
    const showPriority = Boolean(priorityLabel) && (task.priority === 'high' || task.priority === 'urgent');
    return (
        <li
            ref={rowRef}
            data-testid="menubar-row"
            data-task-id={task.id}
            data-reorder-id={canReorder ? task.id : undefined}
            data-reorder-group={canReorder ? reorder?.groupKey : undefined}
            data-dragging={dragging ? 'true' : undefined}
            onPointerDown={canReorder && reorder && onReorderPointerDown ? (event) => onReorderPointerDown(event, task, reorder) : undefined}
            onClickCapture={(event) => {
                if (consumeSuppressedClick?.()) { event.preventDefault(); event.stopPropagation(); }
            }}
            onContextMenu={onContextMenu}
            className={cn(
                'group relative mb-1 flex select-none items-start gap-2.5 rounded-card px-3 py-2.5 transition-[background-color,opacity] duration-200 hover:bg-foreground/[0.06] focus-within:bg-foreground/[0.06] motion-reduce:transition-none',
                'motion-safe:animate-[menubar-row-in_160ms_ease-out]',
                canReorder && 'cursor-grab',
                completing && 'opacity-60',
                dragging && 'opacity-40',
            )}
        >
            {canReorder && dropPlacement && (
                <span
                    aria-hidden
                    data-testid="menubar-drop-line"
                    data-placement={dropPlacement}
                    className={cn(
                        'pointer-events-none absolute inset-x-3 z-20 h-0.5 rounded-full bg-accent-fill',
                        dropPlacement === 'before' ? '-top-[3px]' : '-bottom-[3px]',
                    )}
                >
                    <span className="absolute -left-1 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-accent-fill" />
                </span>
            )}
            {canReorder && reorderLabels && (
                <span
                    aria-hidden
                    title={reorderLabels.drag}
                    className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 text-tertiary opacity-0 transition-opacity duration-150 group-hover:opacity-100 motion-reduce:transition-none"
                >
                    <GripVertical className="h-3.5 w-3 shrink-0" />
                </span>
            )}
            <button
                type="button"
                {...{ [REORDER_IGNORE_ATTR]: '' }}
                aria-label={`${completeLabel}: ${task.title}`}
                onClick={() => onComplete(task)}
                className={cn(
                    'mt-px flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition-all duration-150 active:scale-90 motion-reduce:transition-none motion-reduce:active:scale-100',
                    'focus-ring',
                    completing
                        ? 'border-primary bg-primary text-on-accent'
                        : tone === 'overdue'
                            ? 'border-danger hover:bg-destructive/10'
                            : 'border-muted-foreground/50 hover:border-primary hover:bg-accent-soft',
                )}
            >
                <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path
                        d="M2.5 6.2 5 8.6 9.6 3.6"
                        strokeDasharray="18"
                        strokeDashoffset={completing ? 0 : 18}
                        className={cn(completing && 'motion-safe:animate-[menubar-check-draw_220ms_ease-out]')}
                        style={{ opacity: completing ? 1 : 0 }}
                    />
                </svg>
            </button>
            <button
                type="button"
                data-row-main
                data-task-id={task.id}
                aria-keyshortcuts={canReorder ? 'Alt+ArrowUp Alt+ArrowDown' : undefined}
                onClick={() => onOpen(task)}
                onKeyDown={(event) => onRowKeyDown(event, task)}
                className="min-w-0 flex-1 rounded-sm text-left focus-ring"
            >
                <span
                    className={cn(
                        'line-clamp-2 text-sm font-semibold leading-snug text-foreground transition-colors',
                        completing && 'text-muted-foreground line-through',
                    )}
                >
                    {task.title}
                </span>
                {(meta || project || showPriority) && (
                    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs leading-none">
                        {meta && (
                            <span
                                className={cn(
                                    'rounded-pill px-2 py-[4px] font-medium tabular-nums',
                                    tone === 'overdue' && 'bg-destructive/10 text-danger-text',
                                    tone === 'today' && 'bg-accent-soft text-accent-text',
                                    tone === 'default' && 'bg-well text-muted-foreground',
                                )}
                            >
                                {meta}
                            </span>
                        )}
                        {showPriority && (
                            <span
                                data-testid="menubar-row-priority"
                                className="rounded-pill bg-destructive/10 px-2 py-[4px] font-medium text-danger-text"
                            >
                                {priorityLabel}
                            </span>
                        )}
                        {project && (
                            <span className="inline-flex max-w-[170px] items-center gap-1 text-muted-foreground">
                                <span
                                    aria-hidden
                                    className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground/60"
                                    style={projectColor ? { backgroundColor: projectColor } : undefined}
                                />
                                <span className="truncate">{project.title}</span>
                            </span>
                        )}
                    </span>
                )}
            </button>
            {canReorder && reorder && reorderLabels && onMove && (
                <>
                    <button
                        ref={moreRef}
                        type="button"
                        {...{ [REORDER_IGNORE_ATTR]: '' }}
                        aria-label={`${reorderLabels.moreActions}: ${task.title}`}
                        aria-haspopup="menu"
                        aria-expanded={menu !== null}
                        onClick={onMoreClick}
                        className={cn(
                            'absolute right-1.5 top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-control bg-card text-muted-foreground shadow-soft-sm transition-opacity duration-150 motion-reduce:transition-none',
                            'opacity-0 hover:text-foreground group-hover:opacity-100 group-focus-within:opacity-100 focus-ring',
                            menu && 'opacity-100',
                        )}
                    >
                        <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
                    </button>
                    {menu && (
                        <RowMenu task={task} reorder={reorder} labels={reorderLabels} anchor={menu} onClose={closeMenu} onMove={onMove} />
                    )}
                </>
            )}
        </li>
    );
}
