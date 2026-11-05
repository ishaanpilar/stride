import { ExternalLink } from 'lucide-react';

import { useLanguage } from '../../contexts/language-context';
import { GITHUB_RELEASE_DOWNLOAD_URL } from '../../lib/app-updater';
import { useAppUpdaterStore } from '../../lib/app-updater-store';
import { Switch } from '../ui/Switch';
import { describeUpdaterError, updaterText } from './update-copy';

type AutoUpdateSettingsProps = {
    onOpenLink: (url: string) => void;
};

const formatCheckedAt = (value: string | null): string | null => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

export function AutoUpdateSettings({ onOpenLink }: AutoUpdateSettingsProps) {
    const { t } = useLanguage();
    const autoCheck = useAppUpdaterStore((state) => state.autoCheck);
    const setAutoCheck = useAppUpdaterStore((state) => state.setAutoCheck);
    const lastCheckedAt = useAppUpdaterStore((state) => state.lastCheckedAt);
    const phase = useAppUpdaterStore((state) => state.phase);
    const errorKind = useAppUpdaterStore((state) => state.errorKind);
    const errorStage = useAppUpdaterStore((state) => state.errorStage);
    const checkedLabel = formatCheckedAt(lastCheckedAt);
    const showCheckError = phase === 'error' && errorStage === 'check';

    return (
        <>
            <div className="border-t border-border/50"></div>
            <div data-settings-key="autoUpdate" className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                    <div className="text-muted-foreground">{updaterText(t, 'autoCheck')}</div>
                    <div className="mt-1 text-xs text-tertiary">{updaterText(t, 'autoCheckDesc')}</div>
                    <div className="mt-1 text-xs text-tertiary" data-testid="update-last-checked">
                        {checkedLabel ? updaterText(t, 'lastChecked', { time: checkedLabel }) : updaterText(t, 'neverChecked')}
                    </div>
                </div>
                <Switch
                    checked={autoCheck}
                    onCheckedChange={setAutoCheck}
                    aria-label={updaterText(t, 'autoCheck')}
                />
            </div>
            {showCheckError && (
                <div role="alert" className="space-y-1 text-sm">
                    <p className="text-muted-foreground">{describeUpdaterError(t, errorKind, errorStage)}</p>
                    <button
                        type="button"
                        onClick={() => onOpenLink(GITHUB_RELEASE_DOWNLOAD_URL)}
                        className="inline-flex items-center gap-1 rounded-control text-accent-text hover:underline focus-ring"
                    >
                        {updaterText(t, 'downloadFromGitHub')}
                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </button>
                </div>
            )}
        </>
    );
}
