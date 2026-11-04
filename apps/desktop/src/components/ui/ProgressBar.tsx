import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export interface ProgressBarProps extends Omit<HTMLAttributes<HTMLDivElement>, 'role'> {
    value: number;
    /** Default 100. */
    max?: number;
    /** Accessible name (or pass aria-labelledby). */
    'aria-label'?: string;
    /** Human-readable value, e.g. "3 of 9 done". */
    valueText?: string;
}

/** 6px rounded bar: well track, accent-gradient fill. */
export function ProgressBar({ value, max = 100, valueText, className, ...props }: ProgressBarProps) {
    const safeMax = max > 0 ? max : 100;
    const clamped = Math.min(safeMax, Math.max(0, Number.isFinite(value) ? value : 0));
    const percent = (clamped / safeMax) * 100;
    return (
        <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={safeMax}
            aria-valuenow={clamped}
            aria-valuetext={valueText}
            className={cn('h-1.5 w-full overflow-hidden rounded-pill bg-well shadow-soft-inset', className)}
            {...props}
        >
            <div
                data-progress-fill=""
                className="h-full rounded-pill bg-accent-gradient transition-[width] duration-200 ease-out motion-reduce:transition-none"
                style={{ width: `${percent}%` }}
            />
        </div>
    );
}
