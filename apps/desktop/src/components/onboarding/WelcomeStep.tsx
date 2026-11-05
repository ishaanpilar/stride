import { useOnboardingCopy } from './copy';
import { StepFooter } from './ui';

export function WelcomeStep({
    onNext,
    onOpenSync,
    onOpenImport,
}: {
    onNext: () => void;
    onOpenSync?: () => void;
    onOpenImport?: () => void;
}) {
    const ob = useOnboardingCopy();
    return (
        <div>
            <img src="/logo.png" alt="" width={56} height={56} className="mb-4 h-14 w-14 rounded-2xl" />
            <h2 id="desktop-onboarding-title" className="text-[26px] font-bold leading-8 tracking-tight">
                {ob('onboarding.welcome.title')}
            </h2>
            <p className="mt-3 text-[17px] font-medium leading-6 text-foreground">{ob('onboarding.welcome.idea')}</p>
            <p className="mt-2 text-sm leading-5 text-muted-foreground">{ob('onboarding.welcome.steps')}</p>
            {onOpenSync || onOpenImport ? (
                <p className="mt-4 text-[13px] text-muted-foreground">
                    {ob('onboarding.welcome.haveData')}{' '}
                    {onOpenSync ? (
                        <button type="button" onClick={onOpenSync} className="rounded-sm text-accent-text underline focus-ring">
                            {ob('onboarding.welcome.syncLink')}
                        </button>
                    ) : null}
                    {onOpenSync && onOpenImport ? ' · ' : null}
                    {onOpenImport ? (
                        <button type="button" onClick={onOpenImport} className="rounded-sm text-accent-text underline focus-ring">
                            {ob('onboarding.welcome.importLink')}
                        </button>
                    ) : null}
                </p>
            ) : null}
            <StepFooter primaryLabel={ob('onboarding.welcome.start')} onPrimary={onNext} />
            <div className="mt-5 text-center text-xs text-tertiary">
                <p>{ob('onboarding.welcome.tribute')}</p>
                <p className="mt-0.5 italic">{ob('onboarding.welcome.mind')}</p>
            </div>
        </div>
    );
}
