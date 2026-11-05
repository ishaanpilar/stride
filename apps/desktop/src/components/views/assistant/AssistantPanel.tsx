import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, PanelRightClose, Plus, Send, Sparkles, Square } from 'lucide-react';
import { shallow, useTaskStore } from '@stride/core';
import { ErrorBoundary } from '../../ErrorBoundary';
import { Button } from '../../ui/Button';
import { IconButton } from '../../ui/IconButton';
import { cn } from '../../../lib/utils';
import { useLanguage } from '../../../contexts/language-context';
import { useAssistantStore } from '../../../store/assistant-store';
import { useAssistantDockStore } from '../../../store/assistant-dock-store';
import { getAssistantReadiness, type AssistantReadiness } from '../../../lib/assistant-service';
import { AssistantMarkdown } from './AssistantMarkdown';
import { ChangesCard, ConfirmCard, FALLBACK_SUGGESTIONS, STARTER_SUGGESTIONS, SuggestionChips } from './AssistantParts';

const DISABLED_COPY: Record<'disabled' | 'no-key' | 'unsupported-provider', string> = {
    disabled: 'Turn on AI in settings to use the Assistant.',
    'no-key': 'Add your AI API key in settings to use the Assistant.',
    'unsupported-provider': 'The Assistant works with DeepSeek, OpenAI and Claude (Anthropic). Gemini is not supported yet. Switch provider in AI settings.',
};

export interface AssistantPanelProps {
    onOpenAiSettings?: () => void;
    /** `dock` = compact right-hand panel; `page` = full view. */
    variant?: 'dock' | 'page';
    /** Dock only: pad the header by the macOS overlay title-bar inset (panel sits at the window top edge). */
    padForTitlebar?: boolean;
    /** Dock only: collapse the panel. */
    onClose?: () => void;
}

export function AssistantPanel({ onOpenAiSettings, variant = 'page', padForTitlebar = false, onClose }: AssistantPanelProps) {
    const isDock = variant === 'dock';
    const { language } = useLanguage();
    const aiSettings = useTaskStore((state) => state.settings.ai, shallow);
    const { thread, busy, send, stop, confirm, reject, undoEntry, undoTurn, newChat, hydrate } = useAssistantStore();
    // Re-render when the change log mutates (undo state).
    useAssistantStore((s) => s.logVersion);
    const [readiness, setReadiness] = useState<AssistantReadiness | null>(null);
    const [draft, setDraft] = useState('');
    const [notice, setNotice] = useState<string | null>(null);
    const endRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => { hydrate(); }, [hydrate]);
    useEffect(() => {
        let alive = true;
        void getAssistantReadiness().then((r) => { if (alive) setReadiness(r); });
        return () => { alive = false; };
    }, [aiSettings]);
    useEffect(() => { endRef.current?.scrollIntoView?.({ block: 'end' }); }, [thread.messages.length, thread.pending.length, busy]);
    useEffect(() => { if (!isDock && readiness?.ready) inputRef.current?.focus({ preventScroll: true }); }, [isDock, readiness?.ready]);
    const focusPending = useAssistantDockStore((s) => s.focusPending);
    const consumeFocus = useAssistantDockStore((s) => s.consumeFocus);
    useEffect(() => {
        if (!isDock || !focusPending || !readiness) return;
        inputRef.current?.focus({ preventScroll: true });
        consumeFocus();
    }, [consumeFocus, focusPending, isDock, readiness]);

    const ready = readiness?.ready === true;
    const sendText = useCallback((value: string) => {
        const text = value.trim();
        if (!text || busy || !ready) return;
        setNotice(null);
        void send(text, language);
    }, [busy, language, ready, send]);
    const submit = useCallback(() => {
        const text = draft.trim();
        if (!text || busy || !ready) return;
        setDraft('');
        sendText(text);
    }, [busy, draft, ready, sendText]);

    const runUndo = useCallback(async (action: () => Promise<string | null>) => {
        const error = await action();
        setNotice(error ? `Undo failed: ${error}` : null);
    }, []);

    const turns = useMemo(() => thread.messages, [thread.messages]);

    return (
        <ErrorBoundary>
            <div
                className={cn('flex h-full flex-col', isDock ? 'min-h-0 gap-3' : 'min-h-[60vh] gap-4')}
                data-testid="assistant-panel"
                data-variant={variant}
            >
                <header
                    data-tauri-drag-region={isDock ? true : undefined}
                    className={cn('flex shrink-0 items-center justify-between gap-2', isDock && 'px-4 pb-1')}
                    style={isDock && padForTitlebar ? { paddingTop: 'calc(var(--titlebar-inset, 0px) + 0.75rem)' } : isDock ? { paddingTop: '0.75rem' } : undefined}
                >
                    {isDock ? (
                        <h2 className="flex items-center gap-2 text-[17px] leading-6 font-semibold"><Bot className="h-5 w-5" aria-hidden />Assistant</h2>
                    ) : (
                        <h2 className="flex items-center gap-2 text-[30px] leading-9 font-bold tracking-[-0.02em]"><Bot className="h-7 w-7" aria-hidden />Assistant</h2>
                    )}
                    {isDock && <div data-tauri-drag-region className="h-full min-w-2 flex-1 self-stretch" aria-hidden="true" />}
                    <div className="flex items-center gap-1.5">
                        <Button variant="secondary" size="sm" leadingIcon={<Plus className="h-4 w-4" />} onClick={newChat} disabled={turns.length === 0 && !busy}>
                            New chat
                        </Button>
                        {isDock && onClose && (
                            <IconButton variant="ghost" size="sm" aria-label="Collapse assistant" title="Collapse assistant" onClick={onClose}>
                                <PanelRightClose className="h-4 w-4" aria-hidden="true" />
                            </IconButton>
                        )}
                    </div>
                </header>

                {readiness && !readiness.ready && (
                    <div className={cn('soft-surface rounded-card p-4 text-sm', isDock && 'mx-4')} data-testid="assistant-disabled">
                        <p>{DISABLED_COPY[readiness.reason]}</p>
                        {onOpenAiSettings && <Button className="mt-3" size="sm" onClick={onOpenAiSettings}>Open AI settings</Button>}
                    </div>
                )}

                <div className={cn('min-h-0 flex-1 space-y-4 overflow-y-auto', isDock ? 'px-4' : 'pr-1')} aria-live="polite">
                    {turns.length === 0 && ready && (
                        <div className="soft-surface space-y-3 rounded-card p-4" data-testid="assistant-empty-state">
                            <div className="flex items-center gap-2.5">
                                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft text-accent-text"><Sparkles className="h-4 w-4" aria-hidden /></span>
                                <div>
                                    <h3 className="text-[15px] font-semibold leading-5">Hi, how can I help?</h3>
                                    <p className="text-[13px] leading-[17px] text-muted-foreground">Ask in plain language, or start with one of these.</p>
                                </div>
                            </div>
                            <SuggestionChips suggestions={STARTER_SUGGESTIONS} onPick={sendText} />
                        </div>
                    )}
                    {turns.map((m, index) => {
                        const isAssistant = m.role === 'assistant';
                        const entries = isAssistant && m.turnId ? thread.changes.filter((c) => c.messageId === m.turnId) : [];
                        const pending = isAssistant && m.turnId ? thread.pending.filter((p) => p.messageId === m.turnId) : [];
                        const lastOfTurn = isAssistant && turns.filter((x) => x.turnId === m.turnId && x.role === 'assistant').slice(-1)[0]?.id === m.id;
                        const isLastMessage = index === turns.length - 1;
                        const awaiting = thread.pending.some((p) => p.status === 'pending');
                        const chips = isAssistant && isLastMessage && !busy && !m.isError && !awaiting
                            ? (m.suggestions?.length ? m.suggestions : FALLBACK_SUGGESTIONS)
                            : [];
                        return (
                            <div key={m.id} className={`flex flex-col gap-2 ${isAssistant ? 'items-start' : 'items-end'}`}>
                                {isAssistant ? (
                                    <div className={cn(
                                        'w-full max-w-[85%] rounded-card px-3.5 py-3',
                                        m.isError ? 'bg-destructive/10 text-danger-text ring-1 ring-danger/30' : 'soft-surface',
                                    )}>
                                        <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                                            <Sparkles className="h-3 w-3" aria-hidden />Assistant
                                        </div>
                                        {m.isError ? <p className="text-sm [overflow-wrap:anywhere]">{m.text}</p> : <AssistantMarkdown text={m.text} />}
                                    </div>
                                ) : (
                                    <div className="max-w-[85%] whitespace-pre-wrap rounded-card rounded-br-md bg-accent-soft px-3.5 py-2 text-sm text-foreground [overflow-wrap:anywhere]">
                                        <span className="sr-only">You: </span>{m.text}
                                    </div>
                                )}
                                {lastOfTurn && entries.length > 0 && (
                                    <ChangesCard
                                        entries={entries}
                                        onUndo={(id) => void runUndo(() => undoEntry(id))}
                                        onUndoAll={() => void runUndo(() => undoTurn(m.turnId!))}
                                    />
                                )}
                                {lastOfTurn && pending.map((p) => <ConfirmCard key={p.id} pending={p} onConfirm={(id) => void confirm(id)} onReject={reject} />)}
                                {chips.length > 0 && <SuggestionChips suggestions={chips} onPick={sendText} />}
                            </div>
                        );
                    })}
                    {busy && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                            <span className="flex gap-1" aria-hidden>
                                {[0, 1, 2].map((i) => (
                                    <span key={i} className="h-1.5 w-1.5 rounded-full bg-accent-fill motion-safe:animate-pulse" style={{ animationDelay: `${i * 150}ms` }} />
                                ))}
                            </span>
                            Checking your tasks…
                        </div>
                    )}
                    {notice && <div className="text-xs text-danger-text" role="alert">{notice}</div>}
                    <div ref={endRef} />
                </div>

                {/* Plain textarea on purpose: works with system-wide dictation (e.g. Wispr Flow). */}
                <form
                    className={cn(
                        'flex shrink-0 items-end gap-2 rounded-card bg-well p-2 shadow-soft-inset',
                        'focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2 focus-within:ring-offset-background',
                        isDock ? 'mx-4 mb-[max(1rem,env(safe-area-inset-bottom))]' : 'mb-[max(1rem,env(safe-area-inset-bottom))]',
                    )}
                    data-testid="assistant-composer"
                    onSubmit={(e) => { e.preventDefault(); submit(); }}>
                    <textarea
                        ref={inputRef}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                                e.preventDefault();
                                submit();
                            }
                        }}
                        rows={isDock ? 3 : 2}
                        disabled={!ready}
                        placeholder={ready ? 'Ask or tell the assistant what to do…' : 'Assistant unavailable'}
                        aria-label="Message the assistant"
                        className="min-h-[3rem] flex-1 resize-y rounded-control bg-transparent px-3 py-2 text-sm outline-none placeholder:text-tertiary focus:outline-none focus-visible:outline-none disabled:opacity-50"
                    />
                    {busy ? (
                        <Button type="button" variant="secondary" onClick={stop} leadingIcon={<Square className="h-4 w-4" />}>Stop</Button>
                    ) : (
                        <Button type="submit" variant="primary" disabled={!ready || !draft.trim()} leadingIcon={<Send className="h-4 w-4" />}>Send</Button>
                    )}
                </form>
            </div>
        </ErrorBoundary>
    );
}
