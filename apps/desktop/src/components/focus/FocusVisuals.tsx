import { forwardRef, useEffect, useRef, useState, type CSSProperties } from 'react';
import { canAnimate } from '../../lib/motion';
import { ambientColors, type AmbientKind } from './focus-palette';

const rgbVar = (rgb: readonly number[]) => ({ '--fx-rgb': rgb.join(' ') }) as CSSProperties;

interface AmbientProps {
    kind: AmbientKind;
    progress: number;
    paused?: boolean;
    /** Change to play one soft brightening pulse (a step was ticked). */
    pulseKey?: number;
}

/** Three blurred blobs drifting slowly; colour follows the session (see focus-palette.ts). */
export function FocusAmbient({ kind, progress, paused = false, pulseKey = 0 }: AmbientProps) {
    const colors = ambientColors(kind, progress);
    const [pulsing, setPulsing] = useState(false);
    useEffect(() => {
        if (!pulseKey || !canAnimate()) return;
        setPulsing(false);
        const start = window.requestAnimationFrame(() => setPulsing(true));
        const stop = window.setTimeout(() => setPulsing(false), 1500);
        return () => { window.cancelAnimationFrame(start); window.clearTimeout(stop); };
    }, [pulseKey]);
    return (
        <div className="fx-amb" aria-hidden data-paused={paused ? 'true' : undefined} data-pulse={pulsing ? 'true' : undefined} data-testid="focus-ambient" data-kind={kind}>
            {colors.map((rgb, index) => <i key={index} style={rgbVar(rgb)} />)}
        </div>
    );
}

/** A soft two-colour tint for the mini card, same palette as the stage. */
export function FocusTint({ kind, progress }: { kind: AmbientKind; progress: number }) {
    const colors = ambientColors(kind, progress);
    return (
        <div className="fx-mini-tint" aria-hidden>
            <i style={rgbVar(colors[0])} />
            <i style={rgbVar(colors[1])} />
        </div>
    );
}

interface ClockProps {
    value: string;
    /** Digits rise in one by one (the start of a session). */
    intro?: boolean;
    label: string;
    /** Counting up past 0:00 ("Keep going"): a calmer, dimmer tone. */
    overtime?: boolean;
}

/**
 * Large thin clock. Each character is its own span keyed by its value, so a changing digit
 * re-mounts and plays a short rise (CSS, off when animations are off).
 */
export const FocusClock = forwardRef<HTMLDivElement, ClockProps>(function FocusClock({ value, intro = false, label, overtime = false }, ref) {
    const innerRef = useRef<HTMLDivElement>(null);
    const first = useRef(true);
    useEffect(() => {
        const node = innerRef.current;
        if (!intro || !node || !canAnimate()) return;
        Array.from(node.children).forEach((el, i) => {
            el.animate(
                [{ transform: 'translateY(0.35em)', opacity: 0, filter: 'blur(14px)' }, { transform: 'none', opacity: 1, filter: 'blur(0)' }],
                { duration: 900, delay: 250 + i * 70, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'backwards' },
            );
        });
    }, [intro]);
    useEffect(() => { first.current = false; }, []);
    return (
        <div ref={ref} role="timer" aria-label={label} aria-live="off" className="fx-clock" data-overtime={overtime ? 'true' : undefined}>
            <div ref={innerRef} className="flex" aria-hidden>
                {Array.from(value).map((char, index) => (
                    <span
                        key={`${index}:${char}`}
                        className={char === ':' ? 'c' : char === '+' ? 'p' : `d${first.current ? '' : ' fx-digit-in'}`}
                    >
                        {char}
                    </span>
                ))}
            </div>
        </div>
    );
});
