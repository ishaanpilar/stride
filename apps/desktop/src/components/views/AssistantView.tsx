import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Plus, Send, Square } from 'lucide-react';
import { shallow, useTaskStore } from '@stride/core';
import { ErrorBoundary } from '../ErrorBoundary';
import { Button } from '../ui/Button';
import { useLanguage } from '../../contexts/language-context';
import { useAssistantStore } from '../../store/assistant-store';
import { getAssistantReadiness, type AssistantReadiness } from '../../lib/assistant-service';
import { ChangeChip, ConfirmCard } from './assistant/AssistantParts';

const DISABLED_COPY: Record<'disabled' | 'no-key' | 'unsupported-provider', string> = {
    disabled: 'Turn on AI in settings to use the Assistant.',
    'no-key': 'Add your AI API key in settings to use the Assistant.',
    'unsupported-provider': 'The Assistant works with DeepSeek, OpenAI and Claude (Anthropic). Gemini is not supported yet. Switch provider in AI settings.',
};

const EXAMPLES = [
    "What's urgent today?",
    'Add dentist Friday 5pm and remind me',
    'Move everything non-urgent to next week',
    'Break down "prepare tax return" into steps',
];

export function AssistantView({ onOpenAiSettings }: { onOpenAiSettings?: () => void }) {
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
    useEffect(() => { if (readiness?.ready) inputRef.current?.focus(); }, [readiness?.ready]);

    const ready = readiness?.ready === true;
    const submit = useCallback(() => {
        const text = draft.trim();
        if (!text || busy || !ready) return;
        setDraft('');
        setNotice(null);
        void send(text, language);
    }, [busy, draft, language, ready, send]);

    const runUndo = useCallback(async (action: () => Promise<string | null>) => {
        const error = await action();
        setNotice(error ? `Undo failed: ${error}` : null);
    }, []);

    const turns = useMemo(() => thread.messages, [thread.messages]);

    return (
        <ErrorBoundary>
            <div className="flex h-full min-h-[60vh] flex-col gap-4">
                <header className="flex items-center justify-between">
                    <h2 className="flex items-center gap-2 text-3xl font-bold tracking-tight"><Bot className="h-7 w-7" aria-hidden />Assistant</h2>
                    <Button variant="outline" size="sm" leadingIcon={<Plus className="h-4 w-4" />} onClick={newChat} disabled={turns.length === 0 && !busy}>
                        New chat
                    </Button>
                </header>

                {readiness && !readiness.ready && (
                    <div className="rounded-lg border border-border bg-muted/50 p-4 text-sm" data-testid="assistant-disabled">
                        <p>{DISABLED_COPY[readiness.reason]}</p>
                        {onOpenAiSettings && <Button className="mt-3" size="sm" onClick={onOpenAiSettings}>Open AI settings</Button>}
                    </div>
                )}

                <div className="flex-1 space-y-4 overflow-y-auto pr-1" aria-live="polite">
                    {turns.length === 0 && ready && (
                        <div className="space-y-2 text-sm text-muted-foreground">
                            <p>Ask in plain language. Try:</p>
                            <div className="flex flex-wrap gap-2">
                                {EXAMPLES.map((ex) => (
                                    <button key={ex} type="button" className="rounded-full border border-border px-3 py-1 text-xs hover:bg-accent" onClick={() => { setDraft(ex); inputRef.current?.focus(); }}>
                                        {ex}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                    {turns.map((m) => {
                        const isAssistant = m.role === 'assistant';
                        const entries = isAssistant && m.turnId ? thread.changes.filter((c) => c.messageId === m.turnId) : [];
                        const pending = isAssistant && m.turnId ? thread.pending.filter((p) => p.messageId === m.turnId) : [];
                        const lastOfTurn = isAssistant && turns.filter((x) => x.turnId === m.turnId && x.role === 'assistant').slice(-1)[0]?.id === m.id;
                        const undoable = entries.filter((e) => !e.undone);
                        return (
                            <div key={m.id} className={`flex flex-col gap-2 ${isAssistant ? 'items-start' : 'items-end'}`}>
                                <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm ${m.role === 'user' ? 'bg-primary text-primary-foreground' : m.isError ? 'border border-destructive/40 bg-destructive/10' : 'bg-muted'}`}>
                                    {m.text}
                                </div>
                                {lastOfTurn && entries.length > 0 && (
                                    <div className="flex max-w-[85%] flex-wrap items-center gap-2">
                                        {entries.map((e) => <ChangeChip key={e.id} entry={e} onUndo={(id) => void runUndo(() => undoEntry(id))} />)}
                                        {undoable.length > 1 && (
                                            <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => void runUndo(() => undoTurn(m.turnId!))}>
                                                Undo all
                                            </button>
                                        )}
                                    </div>
                                )}
                                {lastOfTurn && pending.map((p) => <ConfirmCard key={p.id} pending={p} onConfirm={(id) => void confirm(id)} onReject={reject} />)}
                            </div>
                        );
                    })}
                    {busy && <div className="text-sm text-muted-foreground" role="status">Thinking…</div>}
                    {notice && <div className="text-xs text-destructive" role="alert">{notice}</div>}
                    <div ref={endRef} />
                </div>

                {/* Plain textarea on purpose: works with system-wide dictation (e.g. Wispr Flow). */}
                <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); submit(); }}>
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
                        rows={2}
                        disabled={!ready}
                        placeholder={ready ? 'Ask or tell the assistant what to do…' : 'Assistant unavailable'}
                        aria-label="Message the assistant"
                        className="min-h-[3rem] flex-1 resize-y rounded-lg border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                    />
                    {busy ? (
                        <Button type="button" variant="outline" onClick={stop} leadingIcon={<Square className="h-4 w-4" />}>Stop</Button>
                    ) : (
                        <Button type="submit" disabled={!ready || !draft.trim()} leadingIcon={<Send className="h-4 w-4" />}>Send</Button>
                    )}
                </form>
            </div>
        </ErrorBoundary>
    );
}
