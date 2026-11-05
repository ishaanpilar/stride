import { useEffect, useState } from 'react';
import { Switch } from '../ui/Switch';
import { Pill } from '../ui/Pill';
import { useOnboardingCopy } from './copy';
import type { CalendarEnableResult, OnboardingServices } from './onboarding-services';
import { StepFooter } from './ui';

type Props = {
    services: Pick<OnboardingServices, 'getLaunchAtLogin' | 'setLaunchAtLogin' | 'enableCalendar' | 'disableCalendar'>;
    onBack: () => void;
    onNext: () => void;
};

export function CustomizeStep({ services, onBack, onNext }: Props) {
    const ob = useOnboardingCopy();
    const [login, setLogin] = useState(false);
    const [calendar, setCalendar] = useState(false);
    const [busy, setBusy] = useState<'login' | 'calendar' | null>(null);
    const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

    useEffect(() => {
        let cancelled = false;
        services.getLaunchAtLogin().then((value) => { if (!cancelled) setLogin(Boolean(value)); }).catch(() => undefined);
        return () => { cancelled = true; };
    }, []);

    const toggleLogin = async (next: boolean) => {
        setBusy('login');
        setMessage(null);
        try {
            setLogin(Boolean(await services.setLaunchAtLogin(next)));
        } catch {
            setMessage({ tone: 'error', text: ob('onboarding.custom.failed') });
        } finally {
            setBusy(null);
        }
    };

    const toggleCalendar = async (next: boolean) => {
        setBusy('calendar');
        setMessage(null);
        try {
            if (!next) {
                await services.disableCalendar();
                setCalendar(false);
                return;
            }
            const result: CalendarEnableResult = await services.enableCalendar();
            setCalendar(result === 'enabled');
            if (result === 'enabled') setMessage({ tone: 'ok', text: ob('onboarding.custom.calendarOn') });
            else setMessage({ tone: 'error', text: result === 'denied' ? ob('onboarding.custom.calendarDenied') : ob('onboarding.custom.failed') });
        } catch {
            setMessage({ tone: 'error', text: ob('onboarding.custom.failed') });
        } finally {
            setBusy(null);
        }
    };

    return (
        <div>
            <h2 id="desktop-onboarding-title" className="text-xl font-bold tracking-tight">{ob('onboarding.custom.title')}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{ob('onboarding.custom.intro')}</p>
            <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between gap-4 rounded-card bg-card px-4 py-3 shadow-soft-sm">
                    <div className="min-w-0">
                        <div className="text-sm font-medium">{ob('onboarding.custom.login')}</div>
                        <div className="text-[13px] text-muted-foreground">{ob('onboarding.custom.loginDesc')}</div>
                    </div>
                    <Switch checked={login} disabled={busy !== null} aria-label={ob('onboarding.custom.login')} onCheckedChange={(v) => void toggleLogin(v)} />
                </div>
                <div className="flex items-center justify-between gap-4 rounded-card bg-card px-4 py-3 shadow-soft-sm">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 text-sm font-medium">
                            {ob('onboarding.custom.calendar')} <Pill>{ob('onboarding.ai.optional')}</Pill>
                        </div>
                        <div className="text-[13px] text-muted-foreground">{ob('onboarding.custom.calendarDesc')}</div>
                    </div>
                    <Switch checked={calendar} disabled={busy !== null} aria-label={ob('onboarding.custom.calendar')} onCheckedChange={(v) => void toggleCalendar(v)} />
                </div>
            </div>
            <div role="status" aria-live="polite" className={`mt-3 min-h-[20px] text-[13px] ${message?.tone === 'error' ? 'text-danger-text' : 'text-success-text'}`}>
                {message?.text ?? ''}
            </div>
            <p className="mt-1 text-[13px] text-muted-foreground">{ob('onboarding.custom.accent')}</p>
            <StepFooter onBack={onBack} primaryLabel={ob('onboarding.flow.next')} onPrimary={onNext} />
        </div>
    );
}
