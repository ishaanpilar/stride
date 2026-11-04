import { Database, Download, RefreshCw, X } from 'lucide-react';
import { useLanguage } from '../contexts/language-context';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from './ui/Dialog';

type DesktopOnboardingFlowProps = {
    isOpen: boolean;
    busy?: boolean;
    error?: string | null;
    onOpenSync: () => void;
    onOpenImport: () => void;
    onStartFresh: () => void;
    onSkip: () => void;
};

export function DesktopOnboardingFlow({
    isOpen,
    busy = false,
    error = null,
    onOpenSync,
    onOpenImport,
    onStartFresh,
    onSkip,
}: DesktopOnboardingFlowProps) {
    const { t } = useLanguage();
    if (!isOpen) return null;

    return (
        <Dialog


            onClose={() => { if (!busy) onSkip(); }}
            labelledBy="desktop-onboarding-title"


            closeOnBackdrop={false}
            overlayClassName="z-[70] bg-black/55 px-6 py-8"
            panelClassName="max-w-2xl border-border"
        >
            <DialogHeader className="flex items-start justify-between gap-4 px-6 py-5">
                <div className="min-w-0">
                    <h2 id="desktop-onboarding-title" className="text-[17px] font-semibold">
                        {t('onboarding.title')}
                    </h2>
                    <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                        {t('onboarding.subtitle')}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={onSkip}
                    disabled={busy}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label={t('onboarding.skip')}
                >
                    <X className="h-4 w-4" aria-hidden="true" />
                </button>
            </DialogHeader>

            <DialogBody className="grid gap-3 p-6">
                <button
                    type="button"
                    onClick={onStartFresh}
                    disabled={busy}
                    aria-busy={busy}
                    className="group flex items-center gap-4 rounded-card btn-gradient px-4 py-4 text-left transition-colors focus-ring focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60"
                >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/20">
                        <Database className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold">
                            {busy ? t('onboarding.startFreshBusy') : t('onboarding.startFreshTitle')}
                        </span>
                        <span className="mt-0.5 block text-xs text-on-accent">
                            {t('onboarding.startFreshDesc')}
                        </span>
                    </span>
                </button>
                <button
                    type="button"
                    onClick={onOpenSync}
                    disabled={busy}
                    className="group flex items-center gap-4 rounded-card bg-card shadow-soft-sm px-4 py-4 text-left transition-colors hover:bg-accent focus-ring disabled:cursor-not-allowed disabled:opacity-60"
                >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-text">
                        <RefreshCw className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-foreground">{t('onboarding.syncTitle')}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                            {t('onboarding.syncDesc')}
                        </span>
                    </span>
                </button>

                <button
                    type="button"
                    onClick={onOpenImport}
                    disabled={busy}
                    className="group flex items-center gap-4 rounded-card bg-card shadow-soft-sm px-4 py-4 text-left transition-colors hover:bg-accent focus-ring disabled:cursor-not-allowed disabled:opacity-60"
                >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-text">
                        <Download className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-foreground">{t('onboarding.importTitle')}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                            {t('onboarding.importDesc')}
                        </span>
                    </span>
                </button>

                {error ? (
                    <div className="rounded-control bg-destructive/10 px-3 py-2 text-xs text-danger-text">
                        {error}
                    </div>
                ) : null}
            </DialogBody>

            <DialogFooter className="flex flex-wrap items-center justify-between gap-4 bg-well px-6 py-4">
                <p className="text-xs text-muted-foreground">
                    {t('onboarding.footer')}
                </p>
                <button
                    type="button"
                    onClick={onSkip}
                    disabled={busy}
                    className="min-h-9 shrink-0 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {t('onboarding.skipForNow')}
                </button>
            </DialogFooter>
        </Dialog>
    );
}
