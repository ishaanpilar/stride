import { useId, useState } from 'react';
import { CheckCircle2, ExternalLink, KeyRound, Loader2, AlertTriangle } from 'lucide-react';
import { Button } from '../ui/Button';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Pill } from '../ui/Pill';
import { useOnboardingCopy } from './copy';
import { AI_KEY_LINKS, type KeyTestResult, type OnboardingProviderChoice } from './onboarding-services';
import { StepFooter } from './ui';

export type AiStepProps = {
    provider: OnboardingProviderChoice;
    onProviderChange: (value: OnboardingProviderChoice) => void;
    apiKey: string;
    onApiKeyChange: (value: string) => void;
    testKey: (provider: OnboardingProviderChoice, key: string) => Promise<KeyTestResult>;
    saveAi: (provider: OnboardingProviderChoice, key: string) => Promise<void>;
    onOpenLink: (url: string) => void;
    onBack: () => void;
    /** Called after a key is saved (ai true) or the step is skipped (ai false). */
    onDone: (ai: boolean) => void;
};

type Status = { kind: 'idle' } | { kind: 'testing' } | { kind: 'ok' } | { kind: 'error'; message: string };

export function AiStep(props: AiStepProps) {
    const { provider, apiKey, testKey, saveAi } = props;
    const ob = useOnboardingCopy();
    const keyId = useId();
    const [status, setStatus] = useState<Status>({ kind: 'idle' });
    const [verified, setVerified] = useState<string | null>(null);
    const providerName = provider === 'deepseek' ? 'DeepSeek' : 'Claude';
    const trimmed = apiKey.trim();
    const busy = status.kind === 'testing';

    const runTest = async (): Promise<boolean> => {
        setStatus({ kind: 'testing' });
        const result = await testKey(provider, trimmed);
        if (result.ok) {
            setStatus({ kind: 'ok' });
            setVerified(`${provider}:${trimmed}`);
            return true;
        }
        const key = result.reason === 'badKey' ? 'onboarding.ai.badKey' : result.reason === 'rateLimit' ? 'onboarding.ai.rateLimit' : 'onboarding.ai.network';
        setStatus({ kind: 'error', message: ob(key, { provider: providerName }) });
        return result.reason === 'rateLimit';
    };

    const next = async () => {
        if (!trimmed || busy) return;
        const valid = verified === `${provider}:${trimmed}` || await runTest();
        if (!valid) return;
        try {
            await saveAi(provider, trimmed);
            props.onDone(true);
        } catch {
            setStatus({ kind: 'error', message: ob('onboarding.ai.saveFailed') });
        }
    };

    return (
        <div>
            <div className="flex items-center gap-2">
                <h2 id="desktop-onboarding-title" className="text-xl font-bold tracking-tight">{ob('onboarding.ai.title')}</h2>
                <Pill>{ob('onboarding.ai.optional')}</Pill>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{ob('onboarding.ai.intro')}</p>

            <div className="mt-4">
                <SegmentedControl<OnboardingProviderChoice>
                    aria-label={ob('onboarding.ai.providerLabel')}
                    value={provider}
                    onChange={(value) => { props.onProviderChange(value); setStatus({ kind: 'idle' }); }}
                    options={[
                        { value: 'deepseek', label: 'DeepSeek' },
                        { value: 'claude', label: 'Claude' },
                    ]}
                />
            </div>

            <label htmlFor={keyId} className="mt-4 block text-[13px] font-medium">{ob('onboarding.ai.keyLabel')}</label>
            <div className="mt-1 flex items-center gap-2">
                <div className="relative flex-1">
                    <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-tertiary" aria-hidden="true" />
                    <input
                        id={keyId}
                        type="password"
                        autoComplete="off"
                        spellCheck={false}
                        autoCapitalize="off"
                        value={apiKey}
                        onChange={(event) => { props.onApiKeyChange(event.target.value); setStatus({ kind: 'idle' }); }}
                        placeholder={ob('onboarding.ai.keyPlaceholder')}
                        className="h-9 w-full rounded-control bg-well pl-9 pr-3 text-sm shadow-soft-inset placeholder:text-tertiary focus-ring"
                    />
                </div>
                <Button variant="secondary" size="md" onClick={() => void runTest()} disabled={!trimmed || busy}>
                    {busy ? ob('onboarding.ai.testing') : ob('onboarding.ai.test')}
                </Button>
            </div>
            <button
                type="button"
                onClick={() => props.onOpenLink(AI_KEY_LINKS[provider])}
                className="mt-2 inline-flex items-center gap-1 rounded-sm text-[13px] text-accent-text underline focus-ring"
            >
                {ob('onboarding.ai.getKey')} <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </button>

            <div role="status" aria-live="polite" className="mt-3 min-h-[20px] text-[13px]">
                {status.kind === 'testing' ? (
                    <span className="inline-flex items-center gap-1.5 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />{ob('onboarding.ai.testing')}</span>
                ) : null}
                {status.kind === 'ok' ? (
                    <span className="inline-flex items-center gap-1.5 text-success-text"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />{ob('onboarding.ai.ok')}</span>
                ) : null}
                {status.kind === 'error' ? (
                    <span className="inline-flex items-start gap-1.5 text-danger-text"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{status.message}</span>
                ) : null}
            </div>

            <StepFooter
                onBack={props.onBack}
                primaryLabel={ob('onboarding.flow.next')}
                onPrimary={() => void next()}
                primaryDisabled={!trimmed || busy}
                extra={(
                    <Button variant="outline" size="md" onClick={() => props.onDone(false)} disabled={busy}>
                        {ob('onboarding.ai.skip')}
                    </Button>
                )}
            />
        </div>
    );
}
