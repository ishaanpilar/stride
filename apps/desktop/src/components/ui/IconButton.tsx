import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
    /** Required: icon-only controls must have an accessible name. */
    'aria-label': string;
    /** `soft` = raised surface (default), `ghost` = no chrome until hover. */
    variant?: 'soft' | 'ghost';
    /** `md` = 32x32 (default), `sm` = 28x28 for dense rows. */
    size?: 'md' | 'sm';
    children: ReactNode;
}

const variantStyles = {
    soft: 'bg-card text-foreground border border-border shadow-soft-sm hover:bg-accent active:shadow-soft-inset',
    ghost: 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
} as const;

const sizeStyles = {
    md: 'h-8 w-8 min-h-8 min-w-8',
    sm: 'h-7 w-7',
} as const;

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
    { className, variant = 'soft', size = 'md', type = 'button', children, ...props },
    ref,
) {
    return (
        <button
            ref={ref}
            type={type}
            className={cn(
                'inline-flex shrink-0 items-center justify-center rounded-control p-0 transition-[background-color,box-shadow] duration-200 ease-out motion-reduce:transition-none',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                'disabled:pointer-events-none disabled:opacity-50',
                variantStyles[variant],
                sizeStyles[size],
                className,
            )}
            {...props}
        >
            {children}
        </button>
    );
});
