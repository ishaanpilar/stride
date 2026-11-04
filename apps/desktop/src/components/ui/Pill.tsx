import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/utils';

/** `today` follows the accent, but switches to a calm blue when the accent is close to red (see system-accent.ts). */
export type PillTone = 'neutral' | 'accent' | 'today' | 'danger' | 'warning' | 'success';

export interface PillProps extends HTMLAttributes<HTMLSpanElement> {
    tone?: PillTone;
    /** Leading dot: `true` uses the tone colour, a string sets a custom CSS colour (e.g. a project colour). */
    dot?: boolean | string;
    /** Leading icon (14px). */
    icon?: ReactNode;
}

const toneStyles: Record<PillTone, string> = {
    neutral: 'bg-well text-muted-foreground',
    accent: 'bg-accent-soft text-accent-text',
    today: 'today-pill',
    danger: 'bg-danger/10 text-danger-text',
    warning: 'bg-warning-fill/10 text-warning-text',
    success: 'bg-success-fill/10 text-success-text',
};

const dotStyles: Record<PillTone, string> = {
    neutral: 'bg-tertiary',
    accent: 'bg-accent-fill',
    today: 'today-pill-dot',
    danger: 'bg-danger',
    warning: 'bg-warning-fill',
    success: 'bg-success-fill',
};

/** 26px pill for chips, dates and priorities. The label is the meaning; colour is never the only signal. */
export function Pill({ tone = 'neutral', dot, icon, className, children, ...props }: PillProps) {
    return (
        <span
            className={cn(
                'inline-flex h-[26px] max-w-full items-center gap-1.5 whitespace-nowrap rounded-pill px-2.5 text-xs font-medium leading-4 [&_svg]:h-3.5 [&_svg]:w-3.5 [&_svg]:shrink-0',
                toneStyles[tone],
                className,
            )}
            {...props}
        >
            {dot ? (
                <span
                    aria-hidden="true"
                    data-pill-dot=""
                    className={cn('h-2 w-2 shrink-0 rounded-full', typeof dot === 'string' ? undefined : dotStyles[tone])}
                    style={typeof dot === 'string' ? { backgroundColor: dot } : undefined}
                />
            ) : null}
            {icon ? <span aria-hidden="true" className="inline-flex shrink-0">{icon}</span> : null}
            {children}
        </span>
    );
}

export const Chip = Pill;
export type ChipProps = PillProps;
