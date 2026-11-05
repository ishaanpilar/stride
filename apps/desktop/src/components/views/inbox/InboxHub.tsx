import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Brain, Compass, ListChecks, Loader2, MoreHorizontal, SlidersHorizontal, Sparkles } from 'lucide-react';

import { cn } from '../../../lib/utils';
import { registerInboxComposer } from '../../../lib/inline-capture';
import { openQuickCapture } from '../../../lib/quick-capture-service';
import { Button } from '../../ui/Button';
import { IconButton } from '../../ui/IconButton';
import { ViewHeader } from '../../ui/ViewHeader';
import { CaptureComposer, type CaptureComposerHandle } from '../../capture/CaptureComposer';
import type { CaptureText } from '../../capture/useCaptureText';
import type { InboxAiProcessController } from './useInboxAiProcess';

const quietLink = 'focus-ring inline-flex items-center gap-1 rounded-control px-1 text-[13px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline';

export type InboxHubProps = {
    t: CaptureText;
    title: string;
    count: number;
    /** hero = empty Inbox, everything centred; docked = composer on top of the list. */
    variant: 'hero' | 'docked';
    ai: InboxAiProcessController;
    /** The guided one-by-one flow (non-AI) is running. */
    manualProcessing: boolean;
    onManualProcess: () => void;
    onGuidedSweep: () => void;
    viewOptionsOpen: boolean;
    onToggleViewOptions: () => void;
};

function CaptureLinks({ t, onGuidedSweep }: { t: CaptureText; onGuidedSweep: () => void }) {
    return (
        <span className="flex items-center gap-1">
            <button type="button" className={quietLink} onClick={openQuickCapture} data-inbox-brain-dump
                title={t('inboxHub.brainDumpHint', 'Dump everything; AI sorts it into projects and tasks')}>
                <Brain className="h-3.5 w-3.5" aria-hidden="true" />
                {t('inboxHub.brainDump', 'Brain dump')}
            </button>
            <span aria-hidden="true" className="text-tertiary">·</span>
            <button type="button" className={quietLink} onClick={onGuidedSweep} data-inbox-guided-sweep
                title={t('inboxHub.guidedSweepHint', 'Walk through prompts to empty your head')}>
                <Compass className="h-3.5 w-3.5" aria-hidden="true" />
                {t('inboxHub.guidedSweep', 'Guided sweep')}
            </button>
        </span>
    );
}

function useRegisteredComposer() {
    const ref = useRef<CaptureComposerHandle | null>(null);
    useEffect(() => registerInboxComposer({
        focus: (options) => ref.current?.focus(options),
        isVisible: () => {
            const element = ref.current?.element();
            return Boolean(element && element.isConnected && element.getClientRects().length > 0);
        },
    }), []);
    return ref;
}

export function InboxHub(props: InboxHubProps) {
    const { t, title, count, variant, ai, manualProcessing, onManualProcess, onGuidedSweep } = props;
    const composerRef = useRegisteredComposer();
    const thinking = ai.phase === 'thinking';
    const reviewing = ai.phase === 'review' || ai.phase === 'applying';

    if (variant === 'hero') {
        return (
            <div className="motion-view flex min-h-full w-full flex-col items-center justify-center px-4 py-10" data-inbox-hero>
                <h1 className="sr-only">{title}</h1>
                <div className="flex w-full max-w-2xl flex-col items-center gap-5">
                    <p className="text-center text-[15px] text-muted-foreground">
                        {t('inboxHub.heroLead', 'Your Inbox is clear. Dump anything here and leave it; AI sorts it later.')}
                    </p>
                    <CaptureComposer
                        ref={composerRef}
                        variant="hero"
                        autoFocus
                        footer={<CaptureLinks t={t} onGuidedSweep={onGuidedSweep} />}
                    />
                </div>
            </div>
        );
    }

    const notice = ai.notice ? <AiNotice t={t} kind={ai.notice} onManual={onManualProcess} onDismiss={ai.dismissNotice} /> : null;

    return (
        <div className="flex flex-col gap-4" data-inbox-hub>
            <ViewHeader
                title={title}
                count={count > 0 ? t('inboxHub.count', '{{count}} to process', { count }) : undefined}
                actions={(
                    <>
                        {count > 0 && !manualProcessing && !reviewing ? (
                            <Button
                                variant="primary"
                                size="sm"
                                onClick={() => { void ai.start(); }}
                                disabled={thinking}
                                data-inbox-process-ai
                                leadingIcon={thinking
                                    ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                                    : <Sparkles className="h-4 w-4" aria-hidden="true" />}
                            >
                                {thinking ? t('inboxHub.thinking', 'Sorting your Inbox…') : t('process.btn', 'Process Inbox')}
                            </Button>
                        ) : null}
                        <InboxMoreMenu {...props} />
                    </>
                )}
            />
            {!reviewing ? (
                <CaptureComposer
                    ref={composerRef}
                    variant="docked"
                    footer={<span className="ml-auto"><CaptureLinks t={t} onGuidedSweep={onGuidedSweep} /></span>}
                />
            ) : null}
            {notice}
        </div>
    );
}

function AiNotice({ t, kind, onManual, onDismiss }: { t: CaptureText; kind: 'disabled' | 'limited' | 'failed'; onManual: () => void; onDismiss: () => void }) {
    const text = kind === 'disabled'
        ? t('inboxHub.aiOff', 'AI is off, so let’s go through the Inbox one item at a time.')
        : kind === 'limited'
            ? t('inboxHub.aiLimited', 'AI is taking a short break (too many requests). Process one by one, or try again in a minute.')
            : t('inboxHub.aiFailed', 'The AI couldn’t sort the Inbox this time. Nothing changed.');
    return (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-card bg-well px-4 py-3 text-[13px] text-muted-foreground shadow-soft-inset" data-inbox-ai-notice={kind}>
            <span className="min-w-0 flex-1">{text}</span>
            {kind !== 'disabled' ? (
                <Button variant="secondary" size="sm" onClick={() => { onDismiss(); onManual(); }}>
                    {t('inboxHub.oneByOne', 'Process one by one')}
                </Button>
            ) : null}
            <Button variant="ghost" size="sm" onClick={onDismiss}>{t('common.close', 'Close')}</Button>
        </div>
    );
}

function MenuItem({ icon, children, onSelect }: { icon: ReactNode; children: ReactNode; onSelect: () => void }) {
    return (
        <button
            type="button"
            role="menuitem"
            onClick={onSelect}
            className="focus-ring-inset flex h-9 w-full items-center gap-2.5 rounded-control px-2.5 text-left text-[14px] text-foreground hover:bg-accent"
        >
            <span aria-hidden="true" className="inline-flex text-muted-foreground [&_svg]:h-4 [&_svg]:w-4">{icon}</span>
            {children}
        </button>
    );
}

function InboxMoreMenu({ t, count, onManualProcess, onGuidedSweep, viewOptionsOpen, onToggleViewOptions }: InboxHubProps) {
    const [open, setOpen] = useState(false);
    const menuId = useId();
    const rootRef = useRef<HTMLDivElement | null>(null);
    const buttonRef = useRef<HTMLButtonElement | null>(null);

    useEffect(() => {
        if (!open) return undefined;
        const onPointer = (event: MouseEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onPointer);
        const first = rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
        first?.focus();
        return () => document.removeEventListener('mousedown', onPointer);
    }, [open]);

    const choose = (action: () => void) => () => {
        setOpen(false);
        buttonRef.current?.focus();
        action();
    };

    return (
        <div
            ref={rootRef}
            className="relative"
            onKeyDown={(event) => {
                if (!open) return;
                if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    setOpen(false);
                    buttonRef.current?.focus();
                    return;
                }
                if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
                event.preventDefault();
                const items = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
                const index = items.indexOf(document.activeElement as HTMLElement);
                const next = event.key === 'ArrowDown' ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
                items[next]?.focus();
            }}
        >
            <IconButton
                ref={buttonRef}
                aria-label={t('inboxHub.moreOptions', 'More Inbox options')}
                title={t('inboxHub.moreOptions', 'More Inbox options')}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls={open ? menuId : undefined}
                onClick={() => setOpen((value) => !value)}
                data-inbox-more
            >
                <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </IconButton>
            {open ? (
                <div
                    id={menuId}
                    role="menu"
                    aria-label={t('inboxHub.moreOptions', 'More Inbox options')}
                    className={cn('motion-popover absolute right-0 top-full z-30 mt-2 w-64 rounded-sheet border border-border bg-popover p-1.5 text-popover-foreground shadow-soft')}
                >
                    {count > 0 ? (
                        <MenuItem icon={<ListChecks />} onSelect={choose(onManualProcess)}>
                            {t('inboxHub.oneByOne', 'Process one by one')}
                        </MenuItem>
                    ) : null}
                    <MenuItem icon={<Compass />} onSelect={choose(onGuidedSweep)}>{t('inboxHub.guidedSweep', 'Guided sweep')}</MenuItem>
                    <MenuItem icon={<Brain />} onSelect={choose(openQuickCapture)}>{t('inboxHub.brainDump', 'Brain dump')}</MenuItem>
                    <MenuItem icon={<SlidersHorizontal />} onSelect={choose(onToggleViewOptions)}>
                        {viewOptionsOpen
                            ? t('inboxHub.hideViewOptions', 'Hide view options')
                            : t('inboxHub.showViewOptions', 'Sort, filter and group…')}
                    </MenuItem>
                </div>
            ) : null}
        </div>
    );
}
