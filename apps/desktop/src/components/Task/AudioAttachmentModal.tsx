import type { RefObject } from 'react';
import { translateWithFallback, type Attachment } from '@stride/core';
import { Dialog, DialogBody } from '../ui/Dialog';

type AudioAttachmentModalProps = {
    attachment: Attachment | null;
    audioSource: string | null;
    audioRef: RefObject<HTMLAudioElement | null>;
    audioError: string | null;
    audioTranscribing: boolean;
    audioTranscriptionError: string | null;
    onClose: () => void;
    onAudioError: () => void;
    onOpenExternally: () => void;
    onRetryTranscription: () => void;
    t: (key: string) => string;
};

export function AudioAttachmentModal({
    attachment,
    audioSource,
    audioRef,
    audioError,
    audioTranscribing,
    audioTranscriptionError,
    onClose,
    onAudioError,
    onOpenExternally,
    onRetryTranscription,
    t,
}: AudioAttachmentModalProps) {
    if (!attachment || !audioSource) return null;
    const resolveText = (key: string, fallback: string) => {
        return translateWithFallback(t, key, fallback);
    };
    return (
        <Dialog onClose={onClose} label={attachment.title || t('quickAdd.audioNoteTitle')}>
            <DialogBody className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                    <div className="text-sm font-medium">{attachment.title || t('quickAdd.audioNoteTitle')}</div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="text-xs text-muted-foreground hover:text-foreground"
                    >
                        {t('common.close')}
                    </button>
                </div>
                <audio
                    ref={audioRef}
                    controls
                    src={audioSource}
                    className="w-full"
                    onError={onAudioError}
                />
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={onRetryTranscription}
                        disabled={audioTranscribing}
                        className="text-xs px-3 py-1.5 rounded-md border border-border bg-muted/50 text-foreground hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {audioTranscribing
                            ? resolveText('attachments.transcribing', 'Transcribing...')
                            : resolveText('attachments.retryTranscription', 'Re-transcribe')}
                    </button>
                </div>
                {audioError ? (
                    <div className="flex items-center justify-between text-xs text-destructive" role="alert" aria-live="assertive">
                        <span>{audioError}</span>
                        <button
                            type="button"
                            onClick={onOpenExternally}
                            className="text-xs text-muted-foreground hover:text-foreground"
                        >
                            {t('attachments.open')}
                        </button>
                    </div>
                ) : null}
                {audioTranscriptionError ? (
                    <div className="text-xs text-destructive" role="alert" aria-live="assertive">
                        {audioTranscriptionError}
                    </div>
                ) : null}
            </DialogBody>
        </Dialog>
    );
}
