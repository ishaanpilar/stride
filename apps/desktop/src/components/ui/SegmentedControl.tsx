import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

export interface SegmentedOption<T extends string = string> {
    value: T;
    label?: ReactNode;
    icon?: ReactNode;
    /** Required when the option has no text label. */
    ariaLabel?: string;
    disabled?: boolean;
}

export interface SegmentedControlProps<T extends string = string> {
    options: ReadonlyArray<SegmentedOption<T>>;
    value: T;
    onChange: (value: T) => void;
    /** Accessible name of the group. */
    'aria-label': string;
    size?: 'md' | 'sm';
    className?: string;
}

/** Well track with a raised selected segment. Radio-group semantics with arrow-key navigation. */
export function SegmentedControl<T extends string = string>({
    options,
    value,
    onChange,
    size = 'md',
    className,
    ...props
}: SegmentedControlProps<T>) {
    const refs = useRef<Array<HTMLButtonElement | null>>([]);

    const move = (from: number, step: 1 | -1) => {
        for (let i = 1; i <= options.length; i += 1) {
            const next = (from + step * i + options.length * 2) % options.length;
            if (!options[next].disabled) {
                onChange(options[next].value);
                refs.current[next]?.focus();
                return;
            }
        }
    };

    const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
            event.preventDefault();
            move(index, 1);
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
            event.preventDefault();
            move(index, -1);
        }
    };

    const selectedIndex = options.findIndex((option) => option.value === value);

    return (
        <div
            role="radiogroup"
            aria-label={props['aria-label']}
            className={cn('inline-flex items-center gap-0.5 rounded-control bg-well p-0.5 shadow-soft-inset', className)}
        >
            {options.map((option, index) => {
                const selected = option.value === value;
                return (
                    <button
                        key={option.value}
                        ref={(node) => { refs.current[index] = node; }}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        aria-label={option.ariaLabel}
                        disabled={option.disabled}
                        tabIndex={selected || (selectedIndex === -1 && index === 0) ? 0 : -1}
                        onClick={() => onChange(option.value)}
                        onKeyDown={(event) => onKeyDown(event, index)}
                        className={cn(
                            'inline-flex items-center justify-center gap-1.5 rounded-[8px] px-3 text-[13px] font-medium transition-[background-color,box-shadow] duration-200 ease-out motion-reduce:transition-none',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
                            size === 'md' ? 'h-8 min-w-8' : 'h-7 min-w-7',
                            selected
                                ? 'bg-card text-foreground shadow-soft-sm'
                                : 'text-muted-foreground hover:text-foreground',
                        )}
                    >
                        {option.icon}
                        {option.label}
                    </button>
                );
            })}
        </div>
    );
}
