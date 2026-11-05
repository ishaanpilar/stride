import { useCallback, useEffect, useRef, useState } from 'react';
import { Brain } from 'lucide-react';
import { useTaskStore } from '@stride/core';

import { Dialog } from '../ui/Dialog';
import { useUiStore } from '../../store/ui-store';
import { dispatchNavigateEvent } from '../../lib/navigation-events';
import { CAPTURE_BAR_EVENT, type CaptureSaveResult, type OpenCaptureOptions } from '../../lib/inline-capture';
import { openQuickCapture } from '../../lib/quick-capture-service';
import { CaptureComposer } from './CaptureComposer';
import { useCaptureText } from './useCaptureText';

export type CaptureBarProps = {
    /** Controlled open state for tests; otherwise opens on the global capture-bar event. */
    isOpen?: boolean;
    onClose?: () => void;
    save?: (text: string) => Promise<CaptureSaveResult>;
};

const quietLink = 'focus-ring inline-flex items-center gap-1 rounded-control px-1 text-[13px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline';

/**
 * Compact, Spotlight-like capture bar for every view except the Inbox (which captures in place).
 * One field + mic; Enter saves straight to the Inbox and closes; Esc closes.
 */
export function CaptureBar({ isOpen: controlledOpen, onClose, save }: CaptureBarProps) {
    const t = useCaptureText();
    const [openInternal, setOpenInternal] = useState(false);
    const [startVoice, setStartVoice] = useState(false);
    const [instance, setInstance] = useState(0);
    const controlled = controlledOpen !== undefined;
    const isOpen = controlled ? controlledOpen : openInternal;
    const startVoiceSetting = useTaskStore((state) => state.settings?.gtd?.defaultCaptureMethod === 'audio');
    const startVoiceSettingRef = useRef(startVoiceSetting);
    startVoiceSettingRef.current = startVoiceSetting;
    const showToast = useUiStore((state) => state.showToast);

    useEffect(() => {
        if (controlled) return undefined;
        const handler = (event: Event) => {
            const detail = (event as CustomEvent<OpenCaptureOptions | undefined>).detail;
            setStartVoice(detail?.voice ?? (detail?.fromTrigger === true && startVoiceSettingRef.current));
            setInstance((n) => n + 1);
            setOpenInternal(true);
        };
        window.addEventListener(CAPTURE_BAR_EVENT, handler);
        return () => window.removeEventListener(CAPTURE_BAR_EVENT, handler);
    }, [controlled]);

    const close = useCallback(() => {
        if (!controlled) setOpenInternal(false);
        onClose?.();
    }, [controlled, onClose]);

    const handleSaved = useCallback((result: CaptureSaveResult) => {
        if (result.saved === 0) return;
        close();
        const message = result.saved === 1
            ? t('inboxHub.addedOne', 'Added to Inbox')
            : t('inboxHub.addedMany', 'Added {{count}} items to Inbox', { count: result.saved });
        showToast(message, 'success', 3500, {
            label: t('inboxHub.viewInbox', 'View Inbox'),
            onClick: () => dispatchNavigateEvent('inbox'),
        });
    }, [close, showToast, t]);

    if (!isOpen) return null;

    return (
        <Dialog
            onClose={close}
            label={t('inboxHub.captureTitle', 'Capture')}
            placement="center"
            overlayClassName="bg-black/20 px-4"
            panelClassName="max-w-xl overflow-visible p-2"
        >
            <CaptureComposer
                key={instance}
                variant="bar"
                autoFocus
                startVoiceOnMount={startVoice}
                onEscape={close}
                onSaved={handleSaved}
                save={save}
                footer={(
                    <span className="ml-auto flex items-center gap-2">
                        <button
                            type="button"
                            className={quietLink}
                            onClick={() => { close(); openQuickCapture(); }}
                            title={t('inboxHub.brainDumpHint', 'Dump everything; AI sorts it into projects and tasks')}
                        >
                            <Brain className="h-3.5 w-3.5" aria-hidden="true" />
                            {t('inboxHub.brainDump', 'Brain dump')}
                        </button>
                    </span>
                )}
                className="px-1 pb-1"
            />
        </Dialog>
    );
}
