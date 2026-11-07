import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import { POMODORO_ADJUST_STEP_MINUTES } from '@stride/core';
import { Minus, Plus } from 'lucide-react';
import { canAnimate } from '../../lib/motion';
import { cn } from '../../lib/utils';

const FLASH_MS = 1100;

export interface PomodoroAdjustHandle {
    /** Same as pressing "+" (1) or "−" (-1), with the same feedback. For keyboard shortcuts. */
    adjust: (direction: 1 | -1) => void;
}

interface PomodoroAdjustProps {
    canDecrease: boolean;
    canIncrease: boolean;
    /** Change the current phase by this many minutes; returns the seconds actually changed. */
    onAdjust: (deltaMinutes: number) => number;
    tr: (key: string, fallback: string) => string;
    /** xs: the floating timer; sm: menu bar, mini card, Today card; md: the full Focus stage. */
    size?: 'xs' | 'sm' | 'md';
    className?: string;
    /** Extra classes for the two buttons (e.g. the stage's fade-on-idle). */
    buttonClassName?: string;
    /** When given, "−" goes before and "+" after it (around the big time); otherwise side by side. */
    children?: ReactNode;
    testId?: string;
}

const SIZES = {
    xs: { button: 'h-5 w-5', icon: 'h-3 w-3' },
    sm: { button: 'h-6 w-6', icon: 'h-3.5 w-3.5' },
    md: { button: 'h-8 w-8', icon: 'h-4 w-4' },
} as const;

/**
 * The small "−" / "+" beside the time on every timer surface: ±5 min on the current phase, with a
 * brief "+5 min" note. Quiet ghost buttons, muted until hovered.
 */
export const PomodoroAdjust = forwardRef<PomodoroAdjustHandle, PomodoroAdjustProps>(function PomodoroAdjust(
    { canDecrease, canIncrease, onAdjust, tr, size = 'sm', className, buttonClassName, children, testId = 'pomodoro-adjust' },
    ref,
) {
    const [flash, setFlash] = useState<{ key: number; text: string } | null>(null);
    const timer = useRef<number | undefined>(undefined);
    useEffect(() => () => window.clearTimeout(timer.current), []);

    const run = (direction: 1 | -1) => {
        if (direction > 0 ? !canIncrease : !canDecrease) return;
        const changed = onAdjust(direction * POMODORO_ADJUST_STEP_MINUTES);
        if (!changed) return;
        const minutes = String(Math.max(1, Math.round(Math.abs(changed) / 60)));
        const text = changed > 0
            ? tr('pomodoro.adjustAdded', '+{{count}} min').replace('{{count}}', minutes)
            : tr('pomodoro.adjustRemoved', '−{{count}} min').replace('{{count}}', minutes);
        setFlash({ key: Date.now(), text });
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setFlash(null), FLASH_MS);
    };
    useImperativeHandle(ref, () => ({ adjust: run }));

    const { button, icon } = SIZES[size];
    const removeLabel = tr('pomodoro.removeFive', 'Remove 5 minutes');
    const addLabel = tr('pomodoro.addFive', 'Add 5 minutes');
    const buttonClass = cn('pomo-adjust-btn focus-ring', button, buttonClassName);
    const minus = (
        <button type="button" onClick={() => run(-1)} disabled={!canDecrease} aria-label={removeLabel} title={removeLabel} className={buttonClass} data-testid={`${testId}-minus`}>
            <Minus className={icon} aria-hidden />
        </button>
    );
    const plus = (
        <button type="button" onClick={() => run(1)} disabled={!canIncrease} aria-label={addLabel} title={addLabel} className={buttonClass} data-testid={`${testId}-plus`}>
            <Plus className={icon} aria-hidden />
        </button>
    );

    return (
        <span className={cn('pomo-adjust', children ? 'gap-3' : 'gap-0.5', className)} data-size={size} data-testid={testId}>
            {minus}
            {children}
            {plus}
            {flash && (
                <span key={flash.key} className="pomo-flash" data-animate={canAnimate() ? 'true' : undefined} aria-hidden data-testid={`${testId}-flash`}>
                    {flash.text}
                </span>
            )}
            <span className="sr-only" role="status" aria-live="polite">{flash?.text ?? ''}</span>
        </span>
    );
});
