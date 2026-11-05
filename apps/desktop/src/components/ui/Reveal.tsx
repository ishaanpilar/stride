import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface RevealProps {
    open: boolean;
    children: ReactNode;
    className?: string;
}

/**
 * Animates its content in and out: height (grid rows 0fr -> 1fr), opacity and a slight scale.
 * Closed content stays mounted (so it can animate out) but is hidden from assistive tech and inert.
 */
export function Reveal({ open, children, className }: RevealProps) {
    return (
        <div
            className={cn('ui-reveal', className)}
            data-open={open ? 'true' : 'false'}
            aria-hidden={open ? undefined : true}
            inert={open ? undefined : true}
        >
            <div className="ui-reveal__inner">{children}</div>
        </div>
    );
}
