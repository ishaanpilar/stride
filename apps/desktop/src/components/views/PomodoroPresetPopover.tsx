import { useEffect, useRef, type RefObject } from 'react';
import { Check } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface PomodoroPresetChoice {
    id: string;
    name: string;
    /** "25/5" style value. */
    value: string;
}

interface PomodoroPresetPopoverProps {
    open: boolean;
    onClose: () => void;
    presets: PomodoroPresetChoice[];
    activeId?: string;
    onPick: (id: string) => void;
    ariaLabel: string;
    /** Element that toggles the popover (or wraps every trigger); clicks on it are not "outside". */
    anchorRef: RefObject<HTMLElement | null>;
    /** Where focus returns on Esc (defaults to `anchorRef`). */
    focusRef?: RefObject<HTMLElement | null>;
    /** One quiet line above the choices, e.g. "Focus minutes / break minutes". */
    hint?: string;
    /** Positioning classes for the absolutely placed wrapper. */
    className?: string;
}

/** Small preset list that opens from the timer's clock. Esc and outside clicks close it. */
export function PomodoroPresetPopover({ open, onClose, presets, activeId, onPick, ariaLabel, anchorRef, focusRef, hint, className }: PomodoroPresetPopoverProps) {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const first = ref.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')
            ?? ref.current?.querySelector<HTMLButtonElement>('button');
        first?.focus({ preventScroll: true });
        const onPointerDown = (event: PointerEvent | MouseEvent) => {
            const target = event.target as Node;
            if (ref.current?.contains(target) || anchorRef.current?.contains(target)) return;
            onClose();
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            // Close the popover first; do not let Esc also close the window or panel behind it.
            event.stopPropagation();
            event.preventDefault();
            onClose();
            (focusRef ?? anchorRef).current?.focus();
        };
        document.addEventListener('mousedown', onPointerDown);
        window.addEventListener('keydown', onKeyDown, true);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            window.removeEventListener('keydown', onKeyDown, true);
        };
    }, [anchorRef, focusRef, onClose, open]);

    if (!open) return null;
    return (
        <div className={cn('absolute z-30', className)}>
            <div
                ref={ref}
                role="radiogroup"
                aria-label={ariaLabel}
                className="pomo-pop min-w-[11rem] rounded-card bg-popover p-1 text-popover-foreground shadow-soft"
            >
                {hint && (
                    <p className="px-2.5 pb-1 pt-1.5 text-[12px] leading-4 text-muted-foreground" data-testid="pomodoro-preset-hint">{hint}</p>
                )}
                {presets.map((preset) => {
                    const selected = preset.id === activeId;
                    return (
                        <button
                            key={preset.id}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            onClick={() => { onPick(preset.id); onClose(); }}
                            className="flex w-full items-center gap-2 rounded-control px-2.5 py-1.5 text-left text-[13px] hover:bg-accent focus:bg-accent focus:outline-none"
                        >
                            <Check className={cn('h-3.5 w-3.5 shrink-0 text-accent-text', !selected && 'opacity-0')} aria-hidden />
                            <span className="flex-1">{preset.name}</span>
                            <span className="tabular-nums text-tertiary">{preset.value}</span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
