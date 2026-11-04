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
    onComplete: (task: Task) => void;
    onOpen: (task: Task) => void;
    onRowKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>, task: Task) => void;
}

const PRIORITY_ACCENT: Record<string, string> = {
    urgent: 'bg-destructive',
    high: 'bg-warning',
    medium: 'bg-info/70',
};

export function metaLabel(task: Task, tone: PanelRowTone, todayLabel: string): string {
    const value = task.dueDate ?? task.startTime;
    if (!value) return '';
    const timed = hasTimeComponent(value);
    if (tone === 'today') return timed ? safeFormatDate(value, 'p') : todayLabel;
    if (tone === 'overdue') return safeFormatDate(value, timed ? 'MMM d, p' : 'MMM d');
    return safeFormatDate(value, timed ? 'p' : 'MMM d');
}

export function PanelTaskRow({
    task, project, tone, completing, completeLabel, todayLabel, onComplete, onOpen, onRowKeyDown,
}: PanelTaskRowProps) {
    const meta = metaLabel(task, tone, todayLabel);
    const accent = PRIORITY_ACCENT[task.priority ?? ''];
    const projectColor = project ? (project.colorOverride || project.color) : undefined;
    return (
        <li
            data-testid="menubar-row"
            className={cn(
                'group relative flex items-start gap-2.5 rounded-lg px-2.5 py-2 transition-colors duration-150 hover:bg-foreground/[0.06] focus-within:bg-foreground/[0.06]',
                'motion-safe:animate-[menubar-row-in_160ms_ease-out]',
                completing && 'opacity-60',
            )}
        >
            {accent && (
                <span aria-hidden className={cn('absolute left-0.5 top-2.5 bottom-2.5 w-[3px] rounded-full', accent)} />
            )}
            <button
                type="button"
                aria-label={`${completeLabel}: ${task.title}`}
                onClick={() => onComplete(task)}
                className={cn(
                    'mt-px flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition-all duration-150 active:scale-90 motion-reduce:transition-none motion-reduce:active:scale-100',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
                    completing
                        ? 'border-primary bg-primary text-primary-foreground'
                        : tone === 'overdue'
                            ? 'border-destructive/70 hover:bg-destructive/10'
                            : 'border-muted-foreground/50 hover:border-primary hover:bg-primary/10',
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
                className="min-w-0 flex-1 rounded-sm text-left focus:outline-none"
            >
                <span
                    className={cn(
                        'line-clamp-2 text-[13px] font-medium leading-snug text-foreground transition-colors',
                        completing && 'text-muted-foreground line-through',
                    )}
                >
                    {task.title}
                </span>
                {(meta || project) && (
                    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] leading-none">
                        {meta && (
                            <span
                                className={cn(
                                    'rounded-md px-1.5 py-[3px] font-medium tabular-nums',
                                    tone === 'overdue' && 'bg-destructive/10 text-destructive',
                                    tone === 'today' && 'bg-primary/10 text-primary',
                                    tone === 'default' && 'bg-muted text-muted-foreground',
                                )}
                            >
                                {meta}
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
