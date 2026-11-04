import type { Attachment } from '@stride/core';
import { Dialog, DialogBody } from '../ui/Dialog';

type TextAttachmentModalProps = {
    attachment: Attachment | null;
    textContent: string;
    textLoading: boolean;
    textError: string | null;
    onClose: () => void;
    onOpenExternally: () => void;
    t: (key: string) => string;
};

export function TextAttachmentModal({
    attachment,
    textContent,
    textLoading,
    textError,
    onClose,
    onOpenExternally,
    t,
}: TextAttachmentModalProps) {
    if (!attachment) return null;
    return (
        <Dialog
            onClose={onClose}
            label={attachment.title || t('attachments.open')}
            panelClassName="max-w-3xl rounded-lg border-border bg-card shadow-xl"
        >
            <DialogBody className="p-4">
                <div className="flex items-center justify-between">
                    <div className="text-sm font-medium">{attachment.title || t('attachments.open')}</div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="text-xs text-muted-foreground hover:text-foreground"
                    >
                        {t('common.close')}
                    </button>
                </div>
                <div className="mt-3">
                    {textLoading ? (
                        <div className="text-xs text-muted-foreground" aria-live="polite">{t('common.loading')}</div>
                    ) : textError ? (
                        <div className="flex items-center justify-between text-xs text-destructive" role="alert" aria-live="assertive">
                            <span>{textError}</span>
                            <button
                                type="button"
                                onClick={onOpenExternally}
                                className="text-xs text-muted-foreground hover:text-foreground"
                            >
                                {t('attachments.open')}
                            </button>
                        </div>
                    ) : (
                        <pre className="max-h-[60vh] overflow-auto rounded border border-border bg-muted/30 p-3 text-xs text-foreground whitespace-pre-wrap">
                            {textContent}
                        </pre>
                    )}
                </div>
            </DialogBody>
        </Dialog>
    );
}
