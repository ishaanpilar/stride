import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { Dialog } from './ui/Dialog';
import { ProgressBar } from './ui/ProgressBar';
import { Button } from './ui/Button';
import { useLanguage } from '../contexts/language-context';
import { useOnboardingCopy } from './onboarding/copy';
import { WelcomeStep } from './onboarding/WelcomeStep';
import { AiStep } from './onboarding/AiStep';
import { SweepStep } from './onboarding/SweepStep';
import { CustomizeStep } from './onboarding/CustomizeStep';
import { DoneStep } from './onboarding/DoneStep';
import { StepTransition } from './onboarding/ui';
import {
    defaultOnboardingServices,
    type OnboardingProviderChoice,
    type OnboardingServices,
} from './onboarding/onboarding-services';

export type OnboardingDestination = 'inbox' | 'focus';

type DesktopOnboardingFlowProps = {
    isOpen: boolean;
    /** Skip setup (or confirmed leave): the host persists the dismissed flag. */
    onSkip: () => void;
    /** Finished the last step; the host persists the dismissed flag and navigates. */
    onFinish: (destination: OnboardingDestination) => void;
    onOpenSync?: () => void;
    onOpenImport?: () => void;
    onOpenLink?: (url: string) => void;
    /** Test seam: replaces the real AI, capture and system integrations. */
    services?: Partial<OnboardingServices>;
};

const TOTAL_STEPS = 5;

export function DesktopOnboardingFlow(props: DesktopOnboardingFlowProps) {
    if (!props.isOpen) return null;
    return <OnboardingSheet {...props} />;
}

function OnboardingSheet({ onSkip, onFinish, onOpenSync, onOpenImport, onOpenLink, services: serviceOverrides }: DesktopOnboardingFlowProps) {
    const ob = useOnboardingCopy();
    const { language } = useLanguage();
    const services = useMemo<OnboardingServices>(
        () => ({ ...defaultOnboardingServices, ...serviceOverrides }),
        [serviceOverrides],
    );
    const [step, setStep] = useState(0);
    const [provider, setProvider] = useState<OnboardingProviderChoice>('deepseek');
    const [apiKey, setApiKey] = useState('');
    const [aiReady, setAiReady] = useState(false);
    const [sweepText, setSweepText] = useState('');
    const [addedCount, setAddedCount] = useState(0);
    const [confirmLeave, setConfirmLeave] = useState(false);

    useEffect(() => {
        let cancelled = false;
        services.isAiReady().then((ready) => { if (!cancelled && ready) setAiReady(true); }).catch(() => undefined);
        return () => { cancelled = true; };
    }, [services]);

    const dirty = (step === 1 && apiKey.trim().length > 0) || (step === 2 && sweepText.trim().length > 0);
    const back = () => setStep((current) => Math.max(0, current - 1));
    const forward = () => setStep((current) => Math.min(TOTAL_STEPS - 1, current + 1));
    const openLink = (url: string) => { if (onOpenLink) onOpenLink(url); else window.open(url, '_blank', 'noopener,noreferrer'); };

    const requestLeave = () => {
        if (dirty) setConfirmLeave(true);
        else onSkip();
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Enter' || event.metaKey || event.ctrlKey || event.shiftKey || event.defaultPrevented) return;
        if (event.nativeEvent.isComposing) return;
        const target = event.target as HTMLElement;
        if (['TEXTAREA', 'BUTTON', 'A', 'SELECT'].includes(target.tagName) || target.getAttribute('role') === 'switch') return;
        const primary = event.currentTarget.querySelector<HTMLButtonElement>('[data-onboarding-primary]');
        if (primary && !primary.disabled) {
            event.preventDefault();
            primary.click();
        }
    };

    return (
        <Dialog
            onClose={requestLeave}
            labelledBy="desktop-onboarding-title"
            closeOnBackdrop={false}
            onKeyDown={handleKeyDown}
            overlayClassName="z-[70] bg-black/55 px-6 py-8"
            panelClassName="max-w-[560px] border-border"
        >
            <div className="flex items-center gap-4 px-8 pt-6">
                <div className="min-w-0 flex-1">
                    <div className="mb-1.5 text-xs text-muted-foreground" aria-live="polite">
                        {ob('onboarding.flow.stepOf', { current: step + 1, total: TOTAL_STEPS })}
                    </div>
                    <ProgressBar
                        value={step + 1}
                        max={TOTAL_STEPS}
                        aria-label={ob('onboarding.flow.stepOf', { current: step + 1, total: TOTAL_STEPS })}
                    />
                </div>
                {step < TOTAL_STEPS - 1 ? (
                    <Button variant="ghost" size="sm" onClick={onSkip}>{ob('onboarding.flow.skipSetup')}</Button>
                ) : null}
            </div>

            {confirmLeave ? (
                <div role="alertdialog" aria-live="assertive" className="mx-8 mt-4 rounded-card bg-well px-4 py-3 shadow-soft-inset">
                    <div className="text-sm font-semibold">{ob('onboarding.flow.leaveTitle')}</div>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">{ob('onboarding.flow.leaveBody')}</p>
                    <div className="mt-3 flex gap-2">
                        <Button variant="primary" size="sm" onClick={() => setConfirmLeave(false)}>{ob('onboarding.flow.keepGoing')}</Button>
                        <Button variant="secondary" size="sm" onClick={onSkip}>{ob('onboarding.flow.leave')}</Button>
                    </div>
                </div>
            ) : null}

            <div className="min-h-0 overflow-y-auto px-8 pb-8 pt-6">
                <StepTransition key={step}>
                    {step === 0 ? (
                        <WelcomeStep onNext={forward} onOpenSync={onOpenSync} onOpenImport={onOpenImport} />
                    ) : null}
                    {step === 1 ? (
                        <AiStep
                            provider={provider}
                            onProviderChange={setProvider}
                            apiKey={apiKey}
                            onApiKeyChange={setApiKey}
                            testKey={(choice, key) => services.testKey(choice, key, language)}
                            saveAi={services.saveAi}
                            onOpenLink={openLink}
                            onBack={back}
                            onDone={(ai) => {
                                setApiKey('');
                                if (ai) setAiReady(true);
                                forward();
                            }}
                        />
                    ) : null}
                    {step === 2 ? (
                        <SweepStep
                            text={sweepText}
                            onTextChange={setSweepText}
                            aiReady={aiReady}
                            language={language}
                            generateProposal={services.generateProposal}
                            applyProposal={services.applyProposal}
                            seedGuide={services.seedGuide}
                            onBack={back}
                            onDone={(count) => {
                                setAddedCount(count);
                                setSweepText('');
                                forward();
                            }}
                        />
                    ) : null}
                    {step === 3 ? <CustomizeStep services={services} onBack={back} onNext={forward} /> : null}
                    {step === 4 ? <DoneStep onOpen={() => onFinish(addedCount > 0 ? 'inbox' : 'focus')} /> : null}
                </StepTransition>
            </div>
        </Dialog>
    );
}
