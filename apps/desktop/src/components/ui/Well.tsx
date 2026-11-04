import { forwardRef, type ElementType, type HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export interface WellProps extends HTMLAttributes<HTMLElement> {
    /** Rendered element (default `div`). */
    as?: ElementType;
}

/** Gently inset area for grouped or secondary content. Nest at most one level (Surface > Well). */
export const Well = forwardRef<HTMLElement, WellProps>(function Well({ as, className, ...props }, ref) {
    const Component: ElementType = as ?? 'div';
    return (
        <Component
            ref={ref}
            className={cn('rounded-control bg-well text-foreground shadow-soft-inset', className)}
            {...props}
        />
    );
});
