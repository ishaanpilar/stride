import { useId, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface PomodoroRingProps {
    /** 0 to 1 elapsed fraction of the current phase. */
    progress: number;
    phase: 'focus' | 'break';
    /** Outer size in px. */
    size: number;
    /** Ring stroke in px. */
    stroke: number;
    /** Render the soft inset well behind the ring (hero size). */
    well?: boolean;
    /** Running: the stroke sweeps continuously and the ring breathes slowly. */
    running?: boolean;
    /** Change this number to play one quiet completion burst. 0 = none. */
    burstKey?: number;
    className?: string;
    children?: ReactNode;
}

/**
 * Circular progress ring: soft inset well track, accent gradient stroke with a soft glow (calm green
 * on a break). All motion is CSS and switches off under prefers-reduced-motion.
 */
export function PomodoroRing({ progress, phase, size, stroke, well = true, running = false, burstKey = 0, className, children }: PomodoroRingProps) {
    const gradientId = useId();
    const radius = (size - stroke) / 2 - (well ? stroke * 0.5 : 0);
    const circumference = 2 * Math.PI * radius;
    const clamped = Math.min(1, Math.max(0, progress));
    const isFocus = phase === 'focus';
    const arc = (extra?: string) => (
        <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            stroke={`url(#${gradientId})`}
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - clamped)}
            opacity={clamped === 0 ? 0 : 1}
            className={cn('pomo-arc', extra)}
        />
    );
    return (
        <div
            data-testid="pomodoro-ring"
            data-phase={phase}
            data-running={running ? 'true' : 'false'}
            className={cn(
                'pomo-ring relative inline-flex shrink-0 items-center justify-center rounded-full',
                well && 'bg-well shadow-soft-inset',
                className,
            )}
            style={{ width: size, height: size }}
        >
            <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="absolute inset-0 -rotate-90" aria-hidden focusable="false">
                <defs>
                    <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" style={{ stopColor: isFocus ? 'var(--accent-gradient-from)' : 'hsl(var(--success-fill))' }} />
                        <stop offset="100%" style={{ stopColor: isFocus ? 'var(--accent-gradient-to)' : 'hsl(var(--success-fill) / 0.65)' }} />
                    </linearGradient>
                </defs>
                {!well && (
                    <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} className="stroke-foreground/10" />
                )}
                {arc()}
            </svg>
            {/* The same arc, blurred: a soft glow that breathes while the timer runs. */}
            <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="pomo-glow pointer-events-none absolute inset-0 -rotate-90" aria-hidden focusable="false">
                {arc()}
            </svg>
            {burstKey > 0 && <span key={burstKey} className="pomo-burst" aria-hidden />}
            <div className="relative flex flex-col items-center justify-center text-center">{children}</div>
        </div>
    );
}
