import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '../ui/Button';
import { useOnboardingCopy } from './copy';

/** Back / extra / primary row. The primary carries data-onboarding-primary so Enter can trigger it. */
export function StepFooter({
    onBack,
    primaryLabel,
    onPrimary,
    primaryDisabled,
    primaryLoading,
    extra,
}: {
    onBack?: () => void;
    primaryLabel: string;
    onPrimary: () => void;
    primaryDisabled?: boolean;
    primaryLoading?: boolean;
    extra?: ReactNode;
}) {
    const ob = useOnboardingCopy();
    return (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
                {onBack ? (
                    <Button variant="secondary" size="md" onClick={onBack}>{ob('onboarding.flow.back')}</Button>
                ) : null}
                {extra}
            </div>
            <Button
                variant="primary"
                size="md"
                data-onboarding-primary=""
                onClick={onPrimary}
                disabled={primaryDisabled}
                loading={primaryLoading}
            >
                {primaryLabel}
            </Button>
        </div>
    );
}

/** Simple 200ms fade and slide on mount; no motion under prefers-reduced-motion. */
export function StepTransition({ children }: { children: ReactNode }) {
    const [entered, setEntered] = useState(false);
    useEffect(() => {
        const frame = window.requestAnimationFrame(() => setEntered(true));
        return () => window.cancelAnimationFrame(frame);
    }, []);
    return (
        <div
            className={`transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none ${entered ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0 motion-reduce:translate-y-0 motion-reduce:opacity-100'}`}
        >
            {children}
        </div>
    );
}
