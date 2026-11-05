import {
    forwardRef,
    useCallback,
    useEffect,
    useId,
    useImperativeHandle,
    useRef,
    useState,
    type KeyboardEvent,
    type ReactNode,
} from 'react';
import { ArrowUp, Loader2, Mic, Square } from 'lucide-react';
import { useTaskStore } from '@stride/core';

import { cn } from '../../lib/utils';
import { AutosizeTextarea } from '../ui/AutosizeTextarea';
import { isImeComposing } from '../../lib/ime';
import { useCapturePreferences } from '../../lib/capture-preferences';
import { captureLinesToInbox, splitCaptureLines, type CaptureSaveResult, type OpenCaptureOptions } from '../../lib/inline-capture';
import { formatRecordingTime, useVoiceCapture, type VoiceErrorKind, type VoiceUnavailableReason } from '../../hooks/useVoiceCapture';
import { useCaptureText, type CaptureText } from './useCaptureText';

export type CaptureComposerHandle = {
    focus: (options?: OpenCaptureOptions) => void;
    element: () => HTMLElement | null;
};

export type CaptureComposerProps = {
    /**
     * hero = large, centred (empty Inbox); docked = top of the Inbox list; bar = compact capture bar;
     * panel = the menu bar panel's note box (a well, mic only: Enter saves).
     */
    variant: 'hero' | 'docked' | 'bar' | 'panel';
    /** Overrides the default "What's on your mind?". */
    placeholder?: string;
    autoFocus?: boolean;
    /** Start recording on mount (capture bar opened by a trigger with the voice setting on). */
    startVoiceOnMount?: boolean;
    /** Called after lines were saved to the Inbox. */
    onSaved?: (result: CaptureSaveResult) => void;
    /** Escape while idle (the capture bar closes). */
    onEscape?: () => void;
    /** Quiet links under the field (Brain dump, Guided sweep). */
    footer?: ReactNode;
    /** Test seam: defaults to saving through the task store. */
    save?: (text: string) => Promise<CaptureSaveResult>;
    className?: string;
};

export const voiceUnavailableText = (t: CaptureText, reason: VoiceUnavailableReason): string => {
    switch (reason) {
        case 'no-key': return t('inboxHub.voiceNoKey', 'Add a speech-to-text API key in Settings → AI to capture by voice.');
        case 'no-model': return t('inboxHub.voiceNoModel', 'Download a speech model in Settings → AI to capture by voice.');
        case 'desktop-only': return t('inboxHub.voiceDesktopOnly', 'Voice capture with a local model works in the Mac app.');
        case 'sandbox': return t('inboxHub.voiceSandbox', 'Voice capture is off in the sandbox.');
        case 'disabled':
        default:
            return t('inboxHub.voiceDisabled', 'Turn on speech to text in Settings → AI to capture by voice.');
    }
};

export const voiceErrorText = (t: CaptureText, kind: VoiceErrorKind): string => {
    switch (kind) {
        case 'permission': return t('inboxHub.voicePermission', 'Stride can’t use the microphone. Allow it in System Settings → Privacy & Security → Microphone, then try again.');
        case 'no-microphone': return t('inboxHub.voiceNoMic', 'No microphone found. Connect one, or type instead.');
        case 'unsupported': return t('inboxHub.voiceUnsupported', 'Voice capture isn’t supported here. Type instead.');
        case 'empty': return t('inboxHub.voiceEmpty', 'Didn’t catch anything. Try again a little closer to the mic.');
        case 'failed':
        default:
            return t('inboxHub.voiceFailed', 'Couldn’t transcribe that. Try again, or type instead.');
    }
};

export const CaptureComposer = forwardRef<CaptureComposerHandle, CaptureComposerProps>(function CaptureComposer(
    { variant, autoFocus, startVoiceOnMount, onSaved, onEscape, footer, save = captureLinesToInbox, className, placeholder: placeholderOverride },
    ref,
) {
    const t = useCaptureText();
    const startVoiceSetting = useTaskStore((state) => state.settings?.gtd?.defaultCaptureMethod === 'audio');
    const { autoSaveAfterTranscription } = useCapturePreferences();
    const [text, setText] = useState('');
    const [saving, setSaving] = useState(false);
    const [status, setStatus] = useState('');
    const [notice, setNotice] = useState<string | null>(null);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const inputRef = useRef<HTMLTextAreaElement | null>(null);
    const textRef = useRef(text);
    textRef.current = text;
    const hintId = useId();
    const statusId = useId();

    const submit = useCallback(async (value: string = textRef.current) => {
        const lines = splitCaptureLines(value);
        if (lines.length === 0 || saving) return;
        setSaving(true);
        setNotice(null);
        try {
            const result = await save(value);
            if (result.saved > 0) {
                setText('');
                setStatus(result.saved === 1
                    ? t('inboxHub.addedOne', 'Added to Inbox')
                    : t('inboxHub.addedMany', 'Added {{count}} items to Inbox', { count: result.saved }));
            }
            if (result.failed > 0) setNotice(t('inboxHub.addFailed', 'Some lines couldn’t be added. They’re still here.'));
            onSaved?.(result);
        } finally {
            setSaving(false);
            inputRef.current?.focus();
        }
    }, [onSaved, save, saving, t]);

    const handleTranscript = useCallback((transcript: string) => {
        const current = textRef.current.trim();
        const next = current ? `${current}\n${transcript}` : transcript;
        setText(next);
        if (autoSaveAfterTranscription) {
            void submit(next);
            return;
        }
        window.setTimeout(() => {
            const input = inputRef.current;
            if (!input) return;
            input.focus();
            input.setSelectionRange(input.value.length, input.value.length);
        }, 0);
    }, [autoSaveAfterTranscription, submit]);

    const voice = useVoiceCapture({ onTranscript: handleTranscript });
    const voiceAvailable = voice.availability.status === 'available';
    const voiceRef = useRef(voice);
    voiceRef.current = voice;

    const focus = useCallback((options?: OpenCaptureOptions) => {
        inputRef.current?.focus();
        const wantVoice = options?.voice ?? (options?.fromTrigger === true && startVoiceSetting);
        if (wantVoice && voiceRef.current.availability.status === 'available' && voiceRef.current.phase === 'idle') {
            void voiceRef.current.start();
        }
    }, [startVoiceSetting]);

    useImperativeHandle(ref, () => ({ focus, element: () => rootRef.current }), [focus]);

    useEffect(() => {
        if (autoFocus) inputRef.current?.focus();
    }, [autoFocus]);

    // The capture bar opens before availability resolves; start once it is known.
    const startedOnMountRef = useRef(false);
    useEffect(() => {
        if (!startVoiceOnMount || startedOnMountRef.current) return;
        if (voice.availability.status === 'checking') return;
        startedOnMountRef.current = true;
        if (voice.availability.status === 'available') void voice.start();
    }, [startVoiceOnMount, voice]);

    const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
        if (isImeComposing(event)) return;
        if (voice.isRecording && (event.key === 'Escape' || event.key === 'Enter')) {
            event.preventDefault();
            event.stopPropagation();
            void voice.stop();
            return;
        }
        if (event.key === 'Escape' && onEscape) {
            event.preventDefault();
            event.stopPropagation();
            onEscape();
            return;
        }
        if (event.target === inputRef.current && event.key === 'Enter' && !event.shiftKey && !event.altKey) {
            event.preventDefault();
            void submit();
        }
    };

    const handleMic = () => {
        if (!voiceAvailable) {
            if (voice.availability.status === 'unavailable') setNotice(voiceUnavailableText(t, voice.availability.reason));
            return;
        }
        setNotice(null);
        voice.clearError();
        void voice.toggle();
    };

    const micLabel = voice.isRecording
        ? t('inboxHub.voiceStop', 'Stop recording')
        : voice.phase === 'transcribing'
            ? t('inboxHub.voiceTranscribing', 'Transcribing…')
            : voice.availability.status === 'unavailable'
                ? voiceUnavailableText(t, voice.availability.reason)
                : t('inboxHub.voiceStart', 'Record a voice note');

    const isHero = variant === 'hero';
    const isBar = variant === 'bar';
    const isPanel = variant === 'panel';
    const placeholder = placeholderOverride ?? t('inboxHub.placeholder', 'What’s on your mind?');
    const voiceError = voice.error ? voiceErrorText(t, voice.error) : null;
    const message = voiceError ?? notice;
    const lineCount = splitCaptureLines(text).length;

    return (
        <div ref={rootRef} className={cn('w-full', className)} onKeyDown={handleKeyDown} data-capture-composer={variant}>
            <div
                className={cn(
                    'flex items-start gap-2 bg-card text-foreground transition-shadow duration-200 ease-out motion-reduce:transition-none',
                    'focus-within:ring-2 focus-within:ring-primary/50',
                    isPanel
                        ? 'items-center rounded-control bg-well py-1 pl-3 pr-1 shadow-soft-inset'
                        : isBar ? 'rounded-control px-3 py-2' : 'rounded-card shadow-soft border border-border/60',
                    isHero ? 'px-5 py-4' : !isBar && !isPanel && 'px-4 py-3',
                )}
            >
                <AutosizeTextarea
                    ref={inputRef}
                    value={text}
                    rows={1}
                    minHeight={isHero ? 36 : 28}
                    maxHeight={isHero ? 288 : isPanel ? 120 : 224}
                    onChange={(event) => setText(event.target.value)}
                    placeholder={placeholder}
                    aria-label={placeholder}
                    aria-describedby={`${hintId} ${statusId}`}
                    readOnly={voice.isRecording}
                    data-capture-input
                    className={cn(
                        'block min-w-0 flex-1 resize-none border-0 bg-transparent p-0 py-1 shadow-none outline-none placeholder:text-tertiary focus:outline-none focus-visible:outline-none read-only:opacity-60',
                        isHero ? 'text-xl leading-8' : isPanel ? 'text-[14px] leading-6' : 'text-[15px] leading-6',
                    )}
                />
                <div className={cn('flex shrink-0 items-center gap-1.5', isHero ? 'pt-0.5' : 'pt-0')}>
                    {voice.isRecording ? (
                        <span className="inline-flex items-center gap-1.5 text-[13px] tabular-nums text-danger-text" aria-hidden="true">
                            <span className="relative flex h-2.5 w-2.5">
                                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger opacity-60 motion-reduce:animate-none" />
                                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-danger" />
                            </span>
                            {formatRecordingTime(voice.elapsedSeconds)}
                        </span>
                    ) : null}
                    <button
                        type="button"
                        onClick={handleMic}
                        aria-label={micLabel}
                        title={micLabel}
                        aria-pressed={voice.isRecording}
                        aria-disabled={!voiceAvailable || voice.isBusy ? 'true' : undefined}
                        data-capture-mic
                        data-state={voice.availability.status === 'unavailable' ? 'unavailable' : voice.phase}
                        className={cn(
                            'focus-ring inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-control transition-colors duration-200 ease-out motion-reduce:transition-none',
                            voice.isRecording
                                ? 'bg-danger/10 text-danger-text hover:bg-danger/15'
                                : voiceAvailable
                                    ? 'text-muted-foreground hover:bg-accent hover:text-foreground'
                                    : 'cursor-not-allowed text-tertiary opacity-60',
                        )}
                    >
                        {voice.isBusy
                            ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                            : voice.isRecording
                                ? <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                                : <Mic className="h-4 w-4" aria-hidden="true" />}
                    </button>
                    {(!isHero && !isPanel) || text.trim() ? (
                        <button
                            type="button"
                            onClick={() => { void submit(); }}
                            disabled={lineCount === 0 || saving || voice.isRecording}
                            aria-label={lineCount > 1
                                ? t('inboxHub.addMany', 'Add {{count}} to Inbox', { count: lineCount })
                                : t('inboxHub.add', 'Add to Inbox')}
                            title={t('inboxHub.addHint', 'Enter to add · Shift+Enter for a new line')}
                            data-capture-submit
                            className="btn-gradient focus-ring inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-control disabled:pointer-events-none disabled:opacity-40"
                        >
                            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ArrowUp className="h-4 w-4" aria-hidden="true" />}
                        </button>
                    ) : null}
                </div>
            </div>
            <div
                className={cn(
                    'mt-2 flex min-h-5 flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground',
                    isHero && 'justify-center',
                    // The panel stays quiet: hints only while recording, transcribing or adding several lines.
                    isPanel && 'mt-1 min-h-0 px-1 text-[12px]',
                    isPanel && !voice.isRecording && voice.phase !== 'transcribing' && lineCount < 2 && 'sr-only',
                )}
            >
                <span id={hintId}>
                    {voice.isRecording
                        ? t('inboxHub.recordingHint', 'Listening… click stop, or press Enter or Esc when you’re done')
                        : voice.phase === 'transcribing'
                            ? t('inboxHub.voiceTranscribing', 'Transcribing…')
                            : lineCount > 1
                                ? t('inboxHub.multiLineHint', 'Enter adds {{count}} items, one per line', { count: lineCount })
                                : t('inboxHub.addHint', 'Enter to add · Shift+Enter for a new line')}
                </span>
                {footer}
            </div>
            {message ? (
                <p role="alert" className={cn('mt-1.5 text-[13px] text-warning-text', isHero && 'text-center')} data-capture-message>
                    {message}
                </p>
            ) : null}
            <span id={statusId} className="sr-only" role="status" aria-live="polite">{status}</span>
        </div>
    );
});
