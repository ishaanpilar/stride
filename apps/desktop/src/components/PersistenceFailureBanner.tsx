import { AlertTriangle, Loader2 } from 'lucide-react';
import { useTaskStore, type PersistenceFailure } from '@stride/core';

import { useLanguage } from '../contexts/language-context';

type PersistenceFailureBannerViewProps = {
    failure: PersistenceFailure | null;
    onRetry: () => void;
};

export function PersistenceFailureBannerView({ failure, onRetry }: PersistenceFailureBannerViewProps) {
    const { t } = useLanguage();
    if (!failure) return null;

    return (
        <div
            role="alert"
            aria-live="assertive"
            className="fixed left-1/2 top-4 z-[90] flex w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 items-center gap-3 rounded-card ring-1 ring-danger/40 bg-card px-4 py-3 text-foreground shadow-soft"
        >
            <AlertTriangle className="h-5 w-5 shrink-0 text-danger-text" aria-hidden="true" />
            <p className="min-w-0 flex-1 text-sm">{t('persistence.failureMessage')}</p>
            <button
                type="button"
                onClick={onRetry}
                disabled={failure.retrying}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-control btn-gradient px-3 py-1.5 text-sm font-medium focus-ring disabled:cursor-not-allowed disabled:opacity-60"
            >
                {failure.retrying ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
                {failure.retrying ? t('persistence.retrying') : t('errorBoundary.retry')}
            </button>
        </div>
    );
}

export function PersistenceFailureBanner() {
    const failure = useTaskStore((state) => state.persistenceFailure);
    const retryPersistence = useTaskStore((state) => state.retryPersistence);

    return (
        <PersistenceFailureBannerView
            failure={failure}
            onRetry={() => { void retryPersistence().catch(() => undefined); }}
        />
    );
}
