import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Brain, Loader2, X } from 'lucide-react';
import {
    tFallback,
    type ApplyMindSweepResult,
    type MindSweepKind,
    type MindSweepProposal,
    type MindSweepProposalItem,
} from '@stride/core';
import { Dialog, DialogBody } from './ui/Dialog';
import { isImeComposing } from '../lib/ime';
import { useLanguage } from '../contexts/language-context';
import { dispatchNavigateEvent } from '../lib/navigation-events';
import {
    QUICK_CAPTURE_EVENT,
    applyQuickCapture,
    generateQuickCaptureProposal,
    undoQuickCapture,
} from '../lib/quick-capture-service';

type Step = 'capture' | 'review' | 'done';
type Row = MindSweepProposalItem & { included: boolean };

export type QuickCaptureModalProps = {
    /** Test seams; default to the real AI-backed service. */
    generate?: (text: string) => Promise<MindSweepProposal>;
    apply?: (proposal: Pick<MindSweepProposal, 'projects' | 'items'>) => Promise<ApplyMindSweepResult>;
    undo?: (applied: Pick<ApplyMindSweepResult, 'projectIds' | 'taskIds'>) => Promise<boolean>;
    onOpenAiSettings?: () => void;
    /** Controlled open state (used by tests); otherwise opens on the global quick-capture event. */
    isOpen?: boolean;
    onClose?: () => void;
};

const KIND_ORDER: MindSweepKind[] = ['next', 'waiting', 'calendar', 'someday', 'reference', 'inbox'];
const KIND_FALLBACK: Record<MindSweepKind, string> = {
    next: 'Next actions', waiting: 'Waiting for', calendar: 'Calendar / dated', someday: 'Someday', reference: 'Reference', inbox: 'Inbox',
};
const KIND_SINGULAR: Record<MindSweepKind, string> = {
    next: 'Next action', waiting: 'Waiting for', calendar: 'Calendar', someday: 'Someday', reference: 'Reference', inbox: 'Inbox',
};

const btnPrimary = 'px-4 py-2 rounded-lg text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50';
const btnSecondary = 'px-4 py-2 rounded-lg text-sm border border-border hover:bg-accent transition-colors disabled:opacity-50';
const chipClass = 'inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground';

export function QuickCaptureModal(props: QuickCaptureModalProps) {
    const { t: rawT } = useLanguage();
    const t = useCallback((key: string, fallback: string) => tFallback(rawT, key, fallback), [rawT]);
    const [openInternal, setOpenInternal] = useState(false);
    const controlled = props.isOpen !== undefined;
    const isOpen = controlled ? Boolean(props.isOpen) : openInternal;

    const [step, setStep] = useState<Step>('capture');
    const [text, setText] = useState('');
    const [loading, setLoading] = useState(false);
    const [proposal, setProposal] = useState<MindSweepProposal | null>(null);
    const [rows, setRows] = useState<Row[]>([]);
    const [applied, setApplied] = useState<ApplyMindSweepResult | null>(null);
    const [undone, setUndone] = useState(false);
    const [saving, setSaving] = useState(false);
    const runId = useRef(0);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const titleId = useId();

    const generate = props.generate ?? ((value: string) => generateQuickCaptureProposal(value, 'en'));
    const apply = props.apply ?? applyQuickCapture;
    const undo = props.undo ?? undoQuickCapture;

    const reset = useCallback(() => {
        runId.current += 1;
        setStep('capture');
        setText('');
        setLoading(false);
        setProposal(null);
        setRows([]);
        setApplied(null);
        setUndone(false);
        setSaving(false);
    }, []);

    const close = useCallback(() => {
        if (controlled) props.onClose?.();
        else setOpenInternal(false);
        reset();
    }, [controlled, props, reset]);

    useEffect(() => {
        if (controlled) return;
        const handler = () => { reset(); setOpenInternal(true); };
        window.addEventListener(QUICK_CAPTURE_EVENT, handler);
        return () => window.removeEventListener(QUICK_CAPTURE_EVENT, handler);
    }, [controlled, reset]);

    useEffect(() => {
        if (isOpen && step === 'capture') {
            const handle = window.setTimeout(() => textareaRef.current?.focus(), 50);
            return () => window.clearTimeout(handle);
        }
        return undefined;
    }, [isOpen, step]);

    const goNext = useCallback(async () => {
        const value = text.trim();
        if (!value || loading) return;
        const id = ++runId.current;
        setStep('review');
        setLoading(true);
        setProposal(null);
        let result: MindSweepProposal;
        try {
            result = await generate(value);
        } catch {
            result = { projects: [], items: [], summary: '', source: 'fallback', fallbackReason: 'failed' };
        }
        if (id !== runId.current) return;
        setProposal(result);
        setRows(result.items.map((item) => ({ ...item, included: true })));
        setLoading(false);
    }, [text, loading, props.generate]);

    const updateRow = (key: string, patch: Partial<Row>) => setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));

    const includedRows = rows.filter((row) => row.included);
    const projectsById = useMemo(() => new Map((proposal?.projects ?? []).map((p) => [p.ref, p])), [proposal]);
    const visibleProjects = (proposal?.projects ?? []).filter((p) => rows.some((r) => r.projectRef === p.ref));

    const confirm = useCallback(async () => {
        if (!proposal || includedRows.length === 0 || saving) return;
        setSaving(true);
        const items = includedRows.map(({ included: _included, ...item }) => item);
        const result = await apply({ projects: proposal.projects, items });
        setApplied(result);
        setSaving(false);
        setStep('done');
    }, [apply, includedRows, proposal, saving]);

    const handleUndo = useCallback(async () => {
        if (!applied) return;
        const ok = await undo(applied);
        if (ok) setUndone(true);
    }, [applied, undo]);

    if (!isOpen) return null;

    const reviewKeyDown = (event: React.KeyboardEvent) => {
        if (isImeComposing(event as never)) return;
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void confirm();
        }
    };

    const renderRow = (row: Row, nested: boolean) => {
        const projectLabel = row.projectName ?? (row.projectRef ? projectsById.get(row.projectRef)?.title : undefined);
        const dateValue = row.dueDate ?? row.startTime;
        return (
            <li key={row.key} className={`flex flex-wrap items-center gap-2 py-1 ${nested ? 'pl-6' : ''}`}>
                <input
                    type="checkbox"
                    checked={row.included}
                    onChange={(event) => updateRow(row.key, { included: event.target.checked })}
                    aria-label={`${t('quickCapture.include', 'Include')}: ${row.title}`}
                />
                <input
                    value={row.title}
                    onChange={(event) => updateRow(row.key, { title: event.target.value })}
                    aria-label={t('quickCapture.taskTitle', 'Task title')}
                    className={`min-w-[10rem] flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm hover:border-border focus:border-border focus:outline-none focus:ring-2 focus:ring-primary/40 ${row.included ? '' : 'text-muted-foreground line-through'}`}
                />
                {dateValue && (
                    <span className={chipClass}>
                        {dateValue.replace('T', ' ')}
                        <button type="button" aria-label={t('quickCapture.removeDate', 'Remove date')} onClick={() => updateRow(row.key, { dueDate: undefined, startTime: undefined })}><X className="h-3 w-3" /></button>
                    </span>
                )}
                {projectLabel && !nested && (
                    <span className={chipClass}>
                        {projectLabel}
                        <button type="button" aria-label={t('quickCapture.removeProject', 'Remove project')} onClick={() => updateRow(row.key, { projectName: undefined, projectRef: undefined })}><X className="h-3 w-3" /></button>
                    </span>
                )}
                {row.waitingFor && (
                    <span className={chipClass}>
                        {row.waitingFor}
                        <button type="button" aria-label={t('quickCapture.removePerson', 'Remove person')} onClick={() => updateRow(row.key, { waitingFor: undefined })}><X className="h-3 w-3" /></button>
                    </span>
                )}
                {(row.contexts ?? []).map((context) => (
                    <span key={context} className={chipClass}>
                        {context}
                        <button type="button" aria-label={`${t('quickCapture.removeContext', 'Remove context')} ${context}`} onClick={() => updateRow(row.key, { contexts: (row.contexts ?? []).filter((c) => c !== context) })}><X className="h-3 w-3" /></button>
                    </span>
                ))}
                <select
                    value={row.kind}
                    onChange={(event) => updateRow(row.key, { kind: event.target.value as MindSweepKind })}
                    aria-label={t('quickCapture.kind', 'Type')}
                    className="rounded-md border border-border bg-background px-1.5 py-1 text-xs"
                >
                    {KIND_ORDER.map((kind) => (
                        <option key={kind} value={kind}>{KIND_SINGULAR[kind]}</option>
                    ))}
                </select>
            </li>
        );
    };

    const standaloneRows = (kind: MindSweepKind) => rows.filter((row) => row.kind === kind && !row.projectRef);

    const addCount = includedRows.length;
    const addedTasks = applied?.taskIds.length ?? 0;
    const addedProjects = applied?.projectIds.length ?? 0;
    const goTarget = rows.some((r) => r.included && r.kind !== 'inbox') ? 'next' : 'inbox';

    return (
        <Dialog
            onClose={close}
            labelledBy={titleId}
            panelClassName="w-full max-w-2xl"
            closeOnBackdrop={false}
        >
            <DialogBody className="space-y-4 p-6">
                <div className="flex items-center justify-between">
                    <h2 id={titleId} className="flex items-center gap-2 text-lg font-semibold">
                        <Brain className="h-5 w-5" />
                        {t('quickCapture.title', 'Capture')}
                    </h2>
                    <button onClick={close} aria-label={t('common.close', 'Close')} className="text-muted-foreground hover:text-foreground">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {step === 'capture' && (
                    <>
                        <textarea
                            ref={textareaRef}
                            value={text}
                            onChange={(event) => setText(event.target.value)}
                            onKeyDown={(event) => {
                                if (isImeComposing(event)) return;
                                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                                    event.preventDefault();
                                    void goNext();
                                }
                            }}
                            rows={12}
                            autoFocus
                            aria-label={t('quickCapture.title', 'Capture')}
                            placeholder={t('quickCapture.placeholder', 'Empty your head — tasks, worries, ideas, follow-ups…')}
                            className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-primary/40"
                        />
                        <div className="flex items-center justify-between">
                            <span className="text-xs text-muted-foreground">{t('quickCapture.hint', 'Cmd/Ctrl+Enter to continue')}</span>
                            <div className="flex gap-2">
                                <button onClick={close} className={btnSecondary}>{t('common.cancel', 'Cancel')}</button>
                                <button onClick={() => void goNext()} disabled={!text.trim()} className={btnPrimary}>{t('quickCapture.next', 'Next')}</button>
                            </div>
                        </div>
                    </>
                )}

                {step === 'review' && (
                    <div onKeyDown={reviewKeyDown} className="space-y-4">
                        {loading || !proposal ? (
                            <div role="status" className="flex items-center gap-2 py-10 justify-center text-sm text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                {t('quickCapture.organizing', 'Organizing…')}
                            </div>
                        ) : (
                            <>
                                {proposal.source === 'ai' && proposal.summary && (
                                    <p className="text-sm text-muted-foreground">{proposal.summary}</p>
                                )}
                                {proposal.source === 'fallback' && (
                                    <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                                        {proposal.fallbackReason === 'disabled'
                                            ? t('quickCapture.aiOff', 'AI is off — added to Inbox')
                                            : t('quickCapture.aiFailed', "AI couldn't process this, kept as Inbox items")}
                                        {proposal.fallbackReason === 'disabled' && props.onOpenAiSettings && (
                                            <>
                                                {' '}
                                                <button type="button" className="underline" onClick={() => { close(); props.onOpenAiSettings?.(); }}>
                                                    {t('quickCapture.openAiSettings', 'Settings → AI')}
                                                </button>
                                            </>
                                        )}
                                    </p>
                                )}
                                <div className="max-h-[50vh] space-y-4 overflow-y-auto pr-1">
                                    {rows.length === 0 && <p className="text-sm text-muted-foreground">{t('quickCapture.empty', 'Nothing to add.')}</p>}
                                    {visibleProjects.length > 0 && (
                                        <section>
                                            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('quickCapture.newProjects', 'New projects')}</h3>
                                            {visibleProjects.map((project) => (
                                                <div key={project.ref} className="mb-2">
                                                    <div className="flex items-center gap-2 text-sm font-medium">
                                                        <span>{project.title}</span>
                                                        {project.areaName && <span className={chipClass}>{project.areaName}</span>}
                                                        {project.dueDate && <span className={chipClass}>{project.dueDate.replace('T', ' ')}</span>}
                                                                                    </div>
                                                    <ul>{rows.filter((r) => r.projectRef === project.ref).map((r) => renderRow(r, true))}</ul>
                                                </div>
                                            ))}
                                        </section>
                                    )}
                                    {KIND_ORDER.map((kind) => {
                                        const list = standaloneRows(kind);
                                        if (list.length === 0) return null;
                                        return (
                                            <section key={kind}>
                                                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                                    {t(`quickCapture.group.${kind}`, KIND_FALLBACK[kind])}
                                                </h3>
                                                <ul>{list.map((r) => renderRow(r, false))}</ul>
                                            </section>
                                        );
                                    })}
                                </div>
                                <div className="flex items-center justify-between pt-2">
                                    <button onClick={() => { runId.current += 1; setStep('capture'); setLoading(false); }} className={btnSecondary}>{t('common.back', 'Back')}</button>
                                    <button onClick={() => void confirm()} disabled={addCount === 0 || saving} className={btnPrimary}>
                                        {t('quickCapture.addItems', 'Add {{count}} items').replace('{{count}}', String(addCount))}
                                    </button>
                                </div>
                            </>
                        )}
                        {(loading || !proposal) && (
                            <div className="flex justify-start">
                                <button onClick={() => { runId.current += 1; setStep('capture'); setLoading(false); }} className={btnSecondary}>{t('common.back', 'Back')}</button>
                            </div>
                        )}
                    </div>
                )}

                {step === 'done' && applied && (
                    <>
                        <p className="text-base font-medium" role="status">
                            {undone
                                ? t('quickCapture.undone', 'Undone')
                                : t('quickCapture.added', 'Added {{tasks}} tasks and {{projects}} projects')
                                    .replace('{{tasks}}', String(addedTasks))
                                    .replace('{{projects}}', String(addedProjects))}
                        </p>
                        {applied.failed.length > 0 && !undone && (
                            <p className="text-sm text-destructive">{t('quickCapture.someFailed', '{{count}} items could not be added').replace('{{count}}', String(applied.failed.length))}</p>
                        )}
                        <div className="flex justify-between pt-2">
                            <button onClick={() => void handleUndo()} disabled={undone} className={btnSecondary}>{t('common.undo', 'Undo')}</button>
                            <div className="flex gap-2">
                                <button onClick={close} className={btnSecondary}>{t('common.close', 'Close')}</button>
                                {!undone && (
                                    <button
                                        onClick={() => { close(); dispatchNavigateEvent(goTarget); }}
                                        className={btnPrimary}
                                    >
                                        {goTarget === 'next' ? t('quickCapture.goNext', 'Go to Next Actions') : t('quickCapture.goInbox', 'Go to Inbox')}
                                    </button>
                                )}
                            </div>
                        </div>
                    </>
                )}
            </DialogBody>
        </Dialog>
    );
}
