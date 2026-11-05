import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { ArrowDown, ArrowUp, ChevronsUp, GripVertical, MoreHorizontal, Play, Plus } from 'lucide-react';
import { hasTimeComponent, safeFormatDate, type Area, type DropPlacement, type Project, type Task } from '@stride/core';
import { cn } from '../../lib/utils';
import { Pill } from '../ui/Pill';
import { FocusStarIcon } from '../FocusStarIcon';
import { REORDER_IGNORE_ATTR } from './usePanelReorder';
import { isActivePhase, useCompletionPhase } from '../../lib/completion-sequence';
import { useCompletionRowMotion } from '../../lib/completion-motion';

export type PanelMoveAction = 'top' | 'up' | 'down';

/** Present only for rows that can be moved (open rows of the Now tab, within their run). */
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

export interface PanelRowLabels {
    complete: string;
    markNotDone: string;
    today: string;
    overdue: string;
    focus: string;
    /** ▶: start a focus timer on this task. */
    start: string;
    /** ＋ (All tasks): add to Now, i.e. today's focus. */
    addToNow: string;
}

interface PanelTaskRowProps {
    task: Task;
    project?: Project;
    /** Shown when the task has no project. */
    area?: Pick<Area, 'id' | 'name' | 'color'>;
    tone: PanelRowTone;
    /** In today's focus (★). */
    focused?: boolean;
    /** The task is done (ticked this session and kept in the list, struck through). */
    done: boolean;
    labels: PanelRowLabels;
    /** Translated priority name; shown only for high and urgent tasks (as text, never colour alone). */
    priorityLabel?: string;
    /** Date format for the date pill on non-today rows (All tasks). */
    dateFormat?: string;
    onComplete: (task: Task) => void;
    onOpen: (task: Task) => void;
    onRowKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>, task: Task) => void;
    /** ▶ Start (absent when the Pomodoro feature is off). */
    onStart?: (task: Task) => void;
    /** ＋ Add to Now (All tasks only). */
    onAddToNow?: (task: Task) => void;
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

export function metaLabel(task: Task, tone: PanelRowTone, todayLabel: string, dateFormat = 'MMM d'): string {
    const value = task.dueDate ?? task.startTime;
    if (!value) return '';
    const timed = hasTimeComponent(value);
    if (tone === 'today') return timed ? `${todayLabel} ${safeFormatDate(value, 'p')}` : todayLabel;
    if (tone === 'overdue') return safeFormatDate(value, timed ? 'MMM d, p' : 'MMM d');
    return safeFormatDate(value, dateFormat);
}

/** Compact 22px pill for the panel's dense rows (the 26px Pill, tightened). */
const pillClass = 'h-[22px] gap-1 px-2 text-xs';

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
    task, project, area, tone, focused = false, done, labels, priorityLabel, dateFormat, onComplete, onOpen, onRowKeyDown,
    onStart, onAddToNow, reorder, reorderLabels, dragging, dropPlacement, onReorderPointerDown, consumeSuppressedClick, onMove,
}: PanelTaskRowProps) {
    const canReorder = Boolean(reorder && reorderLabels && onMove) && task.status !== 'done';
    const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
    const rowRef = useRef<HTMLLIElement>(null);
    // Same completion sequence as the main window's rows, compact (lib/completion-sequence.ts).
    const phase = useCompletionPhase(task.id);
    const completingNow = isActivePhase(phase);
    const completing = done || completingNow;
    useCompletionRowMotion(rowRef, phase);
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
    const meta = metaLabel(task, tone, labels.today, dateFormat);
    const projectColor = project ? (project.colorOverride || project.color) : undefined;
    const place = project ? { name: project.title, color: projectColor } : area ? { name: area.name, color: area.color } : null;
    const showPriority = Boolean(priorityLabel) && (task.priority === 'high' || task.priority === 'urgent');
    // A task with no date, project or area still says something useful: its first context.
    const context = !meta && !place ? task.contexts?.[0] : undefined;
    const hasMeta = Boolean(meta || place || showPriority || focused || context);
    const open = !completing;
    const actionClass = 'motion-press inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-control transition-[color,background-color,scale] duration-200 ease-out motion-reduce:transition-none focus-ring';
    return (
        <li
            ref={rowRef}
            data-testid="menubar-row"
            data-task-id={task.id}
            data-reorder-id={canReorder ? task.id : undefined}
            data-reorder-group={canReorder ? reorder?.groupKey : undefined}
            data-dragging={dragging ? 'true' : undefined}
            data-completion={phase}
            data-completing={completingNow ? '' : undefined}
            data-done={completing ? '' : undefined}
            onPointerDown={canReorder && reorder && onReorderPointerDown ? (event) => onReorderPointerDown(event, task, reorder) : undefined}
            onClickCapture={(event) => {
                if (consumeSuppressedClick?.()) { event.preventDefault(); event.stopPropagation(); }
            }}
            onContextMenu={onContextMenu}
            className={cn(
                'menubar-row group relative flex select-none items-center gap-2.5 rounded-card bg-card py-2.5 pl-3 pr-2 shadow-soft-sm',
                'transition-[background-color,opacity,box-shadow] duration-200 hover:bg-accent focus-within:bg-accent motion-reduce:transition-none',
                'motion-safe:animate-[menubar-row-in_160ms_ease-out]',
                canReorder && 'cursor-grab',
                completing && !completingNow && 'opacity-70 shadow-none',
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
                        dropPlacement === 'before' ? '-top-[4px]' : '-bottom-[4px]',
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
                aria-label={`${completing ? labels.markNotDone : labels.complete}: ${task.title}`}
                onClick={() => onComplete(task)}
                className={cn(
                    'completion-check flex h-[18px] w-[18px] shrink-0 items-center justify-center self-start rounded-full border-[1.5px] transition-all duration-150 active:scale-90 motion-reduce:transition-none motion-reduce:active:scale-100',
                    hasMeta ? 'mt-[2px]' : 'mt-px',
                    'focus-ring',
                    completing
                        ? 'border-success-fill bg-success-fill text-success-foreground'
                        : tone === 'overdue'
                            ? 'border-danger hover:bg-destructive/10'
                            : 'border-tertiary hover:border-primary hover:bg-accent-soft',
                )}
            >
                <svg viewBox="0 0 12 12" className="completion-check-mark h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path
                        d="M2.5 6.2 5 8.6 9.6 3.6"
                        strokeDasharray="24"
                        strokeDashoffset={completing ? 0 : 24}
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
                        'block truncate text-sm font-semibold leading-5 text-foreground transition-colors duration-300 motion-reduce:transition-none',
                        completing && 'text-muted-foreground',
                    )}
                    title={task.title}
                >
                    {completing ? <span className="completion-strike" data-task-title-struck>{task.title}</span> : task.title}
                </span>
                {hasMeta && (
                    <span className="mt-1 flex flex-wrap items-center gap-1.5 leading-none" data-testid="menubar-row-meta">
                        {meta && (
                            <Pill
                                tone={tone === 'overdue' ? 'danger' : tone === 'today' ? 'today' : 'neutral'}
                                className={cn(pillClass, 'tabular-nums')}
                                data-testid="menubar-row-date"
                            >
                                {tone === 'overdue' ? `${labels.overdue} · ${meta}` : meta}
                            </Pill>
                        )}
                        {focused && (
                            <Pill tone="neutral" className={cn(pillClass, 'text-foreground')} icon={<FocusStarIcon filled />} data-testid="menubar-row-focus">
                                {labels.focus}
                            </Pill>
                        )}
                        {place && (
                            <Pill tone="neutral" dot={place.color || true} className={cn(pillClass, 'max-w-[150px]')}>
                                <span className="truncate">{place.name}</span>
                            </Pill>
                        )}
                        {context && <Pill tone="neutral" className={pillClass}>{context}</Pill>}
                        {showPriority && (
                            <Pill tone="danger" className={cn(pillClass, 'font-semibold')} data-testid="menubar-row-priority">
                                {priorityLabel}
                            </Pill>
                        )}
                    </span>
                )}
            </button>
            <div className="flex shrink-0 items-center gap-1 self-start" {...{ [REORDER_IGNORE_ATTR]: '' }}>
                {canReorder && reorder && reorderLabels && onMove && (
                    <button
                        ref={moreRef}
                        type="button"
                        aria-label={`${reorderLabels.moreActions}: ${task.title}`}
                        aria-haspopup="menu"
                        aria-expanded={menu !== null}
                        onClick={onMoreClick}
                        className={cn(
                            actionClass,
                            'hidden text-muted-foreground hover:bg-well hover:text-foreground group-hover:inline-flex group-focus-within:inline-flex',
                            menu && 'inline-flex',
                        )}
                    >
                        <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
                    </button>
                )}
                {open && onAddToNow && (
                    <button
                        type="button"
                        onClick={() => onAddToNow(task)}
                        aria-label={`${labels.addToNow}: ${task.title}`}
                        title={labels.addToNow}
                        data-testid="menubar-row-add-now"
                        className={cn(actionClass, 'bg-well text-muted-foreground hover:bg-accent-soft hover:text-accent-text')}
                    >
                        <Plus className="h-4 w-4" aria-hidden />
                    </button>
                )}
                {open && onStart && (
                    <button
                        type="button"
                        onClick={() => onStart(task)}
                        aria-label={`${labels.start}: ${task.title}`}
                        title={labels.start}
                        data-testid="menubar-row-start"
                        className={cn(actionClass, 'bg-accent-soft text-accent-text hover:bg-primary hover:text-primary-foreground')}
                    >
                        <Play className="h-3.5 w-3.5 fill-current" aria-hidden />
                    </button>
                )}
            </div>
            {canReorder && reorder && reorderLabels && onMove && menu && (
                <RowMenu task={task} reorder={reorder} labels={reorderLabels} anchor={menu} onClose={closeMenu} onMove={onMove} />
            )}
        </li>
    );
}
