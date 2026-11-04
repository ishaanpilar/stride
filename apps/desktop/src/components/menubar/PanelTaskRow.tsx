import { hasTimeComponent, safeFormatDate, type Project, type Task } from '@stride/core';
import { cn } from '../../lib/utils';

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
}

export function metaLabel(task: Task, tone: PanelRowTone, todayLabel: string): string {
    const value = task.dueDate ?? task.startTime;
    if (!value) return '';
    const timed = hasTimeComponent(value);
    if (tone === 'today') return timed ? safeFormatDate(value, 'p') : todayLabel;
    if (tone === 'overdue') return safeFormatDate(value, timed ? 'MMM d, p' : 'MMM d');
    return safeFormatDate(value, timed ? 'p' : 'MMM d');
}

export function PanelTaskRow({
    task, project, tone, completing, completeLabel, todayLabel, priorityLabel, onComplete, onOpen, onRowKeyDown,
}: PanelTaskRowProps) {
    const meta = metaLabel(task, tone, todayLabel);
    const projectColor = project ? (project.colorOverride || project.color) : undefined;
    const showPriority = Boolean(priorityLabel) && (task.priority === 'high' || task.priority === 'urgent');
    return (
        <li
            data-testid="menubar-row"
            className={cn(
                'group relative mb-1 flex items-start gap-2.5 rounded-card px-3 py-2.5 transition-colors duration-200 hover:bg-foreground/[0.06] focus-within:bg-foreground/[0.06]',
                'motion-safe:animate-[menubar-row-in_160ms_ease-out]',
                completing && 'opacity-60',
            )}
        >
            <button
                type="button"
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
        </li>
    );
}
