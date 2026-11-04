import { forwardRef, type ElementType, type HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export interface SurfaceProps extends HTMLAttributes<HTMLElement> {
    /** Rendered element (default `div`). */
    as?: ElementType;
    /** `sm` = row-sized shadow and 14px radius (default); `lg` = big panel shadow and 16px radius. */
    size?: 'sm' | 'lg';
    /** Selected state: accent-soft fill with a 1px accent hairline. */
    selected?: boolean;
}

export const Surface = forwardRef<HTMLElement, SurfaceProps>(function Surface(
    { as, size = 'sm', selected = false, className, ...props },
    ref,
) {
    const Component: ElementType = as ?? 'div';
    return (
        <Component
            ref={ref}
            data-selected={selected || undefined}
            className={cn(
                'text-card-foreground',
                size === 'lg' ? 'rounded-sheet shadow-soft' : 'rounded-card shadow-soft-sm',
                selected ? 'bg-accent-soft ring-1 ring-accent-fill' : 'bg-card',
                className,
            )}
            {...props}
        />
    );
});
