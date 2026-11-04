import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { ProgressBar } from './ProgressBar';

export interface ViewHeaderProgress {
    /** Left muted line, e.g. "Today: 3 of 9 done". */
    leftText?: ReactNode;
    /** Right muted line, e.g. "6 left · about 2 h 10 m". */
    rightText?: ReactNode;
    /** Progress value, 0..max. */
    value: number;
    /** Default 1 (so `value` is a 0..1 fraction). */
    max?: number;
    /** Accessible name for the progress bar. */
    label?: string;
}

export interface ViewHeaderProps {
    title: ReactNode;
    /** Count beside the title (e.g. "15 tasks"). */
    count?: ReactNode;
    /** Optional progress line + bar under the title. */
    progress?: ViewHeaderProgress;
    /** Optional trailing actions on the title baseline. */
    actions?: ReactNode;
    /** Heading id, so a view can use aria-labelledby. */
    titleId?: string;
    className?: string;
}

/** View title (30/36 bold) + count, with an optional progress line and bar. */
export function ViewHeader({ title, count, progress, actions, titleId, className }: ViewHeaderProps) {
    return (
        <header className={cn('flex flex-col gap-3', className)}>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
                {/* The title never truncates: actions wrap below it when space runs out. */}
                <h1 id={titleId} className="max-w-full shrink-0 break-words text-[30px] font-bold leading-9 tracking-[-0.02em] text-foreground">
                    {title}
                </h1>
                {count !== undefined && count !== null && count !== false ? (
                    <span data-testid="view-header-count" className="shrink-0 text-[15px] leading-5 text-muted-foreground">
                        {count}
                    </span>
                ) : null}
                {actions ? <div className="ml-auto flex flex-wrap items-center justify-end gap-2 self-center">{actions}</div> : null}
            </div>
            {progress ? (
                <div className="flex flex-col gap-2">
                    {(progress.leftText || progress.rightText) ? (
                        <div className="flex items-baseline justify-between gap-4 text-sm text-muted-foreground">
                            <span>{progress.leftText}</span>
                            <span className="text-right tabular-nums">{progress.rightText}</span>
                        </div>
                    ) : null}
                    <ProgressBar
                        value={progress.value}
                        max={progress.max ?? 1}
                        aria-label={progress.label ?? (typeof progress.leftText === 'string' ? progress.leftText : 'Progress')}
                    />
                </div>
            ) : null}
        </header>
    );
}
