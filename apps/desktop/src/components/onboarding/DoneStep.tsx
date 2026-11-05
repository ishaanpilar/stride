import { CheckCircle2 } from 'lucide-react';
import { useOnboardingCopy } from './copy';
import { StepFooter } from './ui';

export function DoneStep({ onOpen }: { onOpen: () => void }) {
    const ob = useOnboardingCopy();
    const Kbd = ({ children }: { children: string }) => (
        <kbd className="rounded-control bg-well px-2 py-0.5 font-sans text-xs font-semibold shadow-soft-inset">{children}</kbd>
    );
    return (
        <div>
            <CheckCircle2 className="mb-3 h-10 w-10 text-success-text" aria-hidden="true" />
            <h2 id="desktop-onboarding-title" className="text-[26px] font-bold tracking-tight">{ob('onboarding.done.title')}</h2>
            <ul className="mt-4 space-y-2 text-sm">
                <li className="flex items-center justify-between gap-3 rounded-card bg-card px-4 py-3 shadow-soft-sm">
                    <span>{ob('onboarding.done.tipCapture')}</span><Kbd>⌘⇧K</Kbd>
                </li>
                <li className="flex items-center justify-between gap-3 rounded-card bg-card px-4 py-3 shadow-soft-sm">
                    <span>{ob('onboarding.done.tipAssistant')}</span><Kbd>⌘⇧J</Kbd>
                </li>
                <li className="rounded-card bg-card px-4 py-3 text-muted-foreground shadow-soft-sm">{ob('onboarding.done.tipPlaces')}</li>
            </ul>
            <StepFooter primaryLabel={ob('onboarding.done.open')} onPrimary={onOpen} />
        </div>
    );
}
