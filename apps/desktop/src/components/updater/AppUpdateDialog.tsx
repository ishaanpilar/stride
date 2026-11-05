import { useId, useMemo } from 'react';
import { Download, ExternalLink, RefreshCw, Sparkles } from 'lucide-react';

import { useLanguage } from '../../contexts/language-context';
import { GITHUB_RELEASE_DOWNLOAD_URL, toReleaseNotesMarkdown } from '../../lib/app-updater';
import { useAppUpdaterStore } from '../../lib/app-updater-store';
import { AssistantMarkdown } from '../views/assistant/AssistantMarkdown';
import { Button } from '../ui/Button';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '../ui/Dialog';
import { ProgressBar } from '../ui/ProgressBar';
import { describeUpdateProgress, describeUpdaterError, updaterText } from './update-copy';

type AppUpdateDialogProps = {
    blocked?: boolean;
    onOpenDownloadPage: (url: string) => void;
};

export function AppUpdateDialog({ blocked = false, onOpenDownloadPage }: AppUpdateDialogProps) {
    const { t } = useLanguage();
    const titleId = useId();
    const bodyId = useId();
    const dialogOpen = useAppUpdaterStore((state) => state.dialogOpen);
    const phase = useAppUpdaterStore((state) => state.phase);
    const update = useAppUpdaterStore((state) => state.update);
    const progress = useAppUpdaterStore((state) => state.progress);
    const errorKind = useAppUpdaterStore((state) => state.errorKind);
    const errorStage = useAppUpdaterStore((state) => state.errorStage);
    const installUpdate = useAppUpdaterStore((state) => state.installUpdate);
    const remindLater = useAppUpdaterStore((state) => state.remindLater);
    const skipVersion = useAppUpdaterStore((state) => state.skipVersion);
    const notes = useMemo(() => toReleaseNotesMarkdown(update?.notes ?? ''), [update?.notes]);

    if (!dialogOpen || blocked || !update) return null;

    const busy = phase === 'downloading' || phase === 'installing' || phase === 'restarting';
    const showError = phase === 'error' && errorStage !== 'check';
    const progressValue = progress && progress.totalBytes ? (progress.downloadedBytes / progress.totalBytes) * 100 : 0;
    const statusText = phase === 'downloading'
        ? describeUpdateProgress(t, progress)
        : phase === 'installing'
            ? updaterText(t, 'installing')
            : phase === 'restarting'
                ? updaterText(t, 'restarting')
                : null;

    return (
        <Dialog
            onClose={() => { if (!busy) remindLater(); }}
            labelledBy={titleId}
            describedBy={bodyId}
            closeOnBackdrop={false}
            closeOnEscape={!busy}
            overlayClassName="z-[60] px-4"
            panelClassName="max-w-lg max-h-[80vh] rounded-sheet"
        >
            <DialogHeader className="px-5 pt-5 pb-3">
                <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-accent-soft text-accent-text">
                        <Sparkles className="h-4 w-4" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                        <h3 id={titleId} className="text-[17px] font-semibold leading-6">
                            {updaterText(t, 'title', { version: update.version })}
                        </h3>
                        <p id={bodyId} className="mt-1 text-sm leading-6 text-muted-foreground">
                            {updaterText(t, 'subtitle', { current: update.currentVersion })}
                        </p>
                    </div>
                </div>
            </DialogHeader>
            <DialogBody className="flex-1 px-5 pb-2">
                <h4 className="mb-2 text-xs font-semibold text-muted-foreground">{updaterText(t, 'notesHeading')}</h4>
                <div
                    data-testid="app-update-notes"
                    className="max-h-64 overflow-y-auto rounded-card bg-well p-3 shadow-soft-inset"
                >
                    {notes
                        ? <AssistantMarkdown text={notes} quotedNames="text" className="max-w-none" />
                        : <p className="text-sm text-muted-foreground">{updaterText(t, 'noNotes')}</p>}
                </div>
                {statusText && (
                    <div className="mt-4 space-y-2" aria-live="polite">
                        <ProgressBar
                            value={phase === 'downloading' ? progressValue : 100}
                            aria-label={updaterText(t, 'progressLabel')}
                            valueText={statusText}
                        />
                        <p className="text-xs text-muted-foreground">{statusText}</p>
                    </div>
                )}
                {showError && (
                    <div role="alert" className="mt-4 space-y-2 rounded-card bg-well p-3 text-sm">
                        <p>{describeUpdaterError(t, errorKind, errorStage)}</p>
                        <button
                            type="button"
                            onClick={() => onOpenDownloadPage(GITHUB_RELEASE_DOWNLOAD_URL)}
                            className="inline-flex items-center gap-1 text-accent-text hover:underline focus-ring rounded-control"
                        >
                            {updaterText(t, 'downloadFromGitHub')}
                            <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        </button>
                    </div>
                )}
            </DialogBody>
            <DialogFooter className="flex flex-wrap items-center justify-between gap-2 px-5 py-4">
                <Button variant="ghost" size="sm" onClick={skipVersion} disabled={busy}>
                    {updaterText(t, 'skip')}
                </Button>
                <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={remindLater} disabled={busy}>
                        {updaterText(t, 'later')}
                    </Button>
                    {errorStage === 'relaunch' ? null : (
                        <Button
                            onClick={() => void installUpdate()}
                            loading={busy}
                            disabled={busy}
                            leadingIcon={showError
                                ? <RefreshCw className="h-4 w-4" aria-hidden="true" />
                                : <Download className="h-4 w-4" aria-hidden="true" />}
                        >
                            {showError ? updaterText(t, 'tryAgain') : updaterText(t, 'install')}
                        </Button>
                    )}
                </div>
            </DialogFooter>
        </Dialog>
    );
}
