import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface SearchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
    /** Shortcut hint shown at the trailing edge, e.g. "⌘F". Decorative (aria-hidden). */
    shortcutHint?: ReactNode;
    /** Class for the outer well wrapper (use `className` for the input itself). */
    wrapperClassName?: string;
}

/** Search input in a well with a magnifier and optional shortcut hint. Forwards ref to the <input>. */
export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
    { shortcutHint, wrapperClassName, className, placeholder, 'aria-label': ariaLabel, ...props },
    ref,
) {
    return (
        <div
            className={cn(
                'flex h-9 min-w-0 items-center gap-2 rounded-control bg-well px-3 text-foreground shadow-soft-inset',
                'focus-within:ring-2 focus-within:ring-ring',
                wrapperClassName,
            )}
        >
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
                ref={ref}
                type="search"
                placeholder={placeholder}
                aria-label={ariaLabel ?? placeholder ?? 'Search'}
                className={cn(
                    'min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-tertiary placeholder:opacity-100 [&::-webkit-search-cancel-button]:hidden',
                    className,
                )}
                {...props}
            />
            {shortcutHint ? (
                <kbd aria-hidden="true" className="shrink-0 font-sans text-[13px] text-tertiary">{shortcutHint}</kbd>
            ) : null}
        </div>
    );
});
