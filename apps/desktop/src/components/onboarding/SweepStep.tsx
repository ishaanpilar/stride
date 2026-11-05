import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { ApplyMindSweepResult, Language, MindSweepProposal } from '@stride/core';
import { Button } from '../ui/Button';
import { useOnboardingCopy } from './copy';
import { ProposalReview, type ReviewRow } from './ProposalReview';
import { StepFooter } from './ui';

export type SweepStepProps = {
    text: string;
    onTextChange: (value: string) => void;
    aiReady: boolean;
    language: Language;
    generateProposal: (text: string, language: Language) => Promise<MindSweepProposal>;
    applyProposal: (proposal: Pick<MindSweepProposal, 'projects' | 'items'>) => Promise<ApplyMindSweepResult>;
    seedGuide: (language: Language) => Promise<string | null>;
    onBack: () => void;
    /** Number of tasks/projects created (0 when skipped). */
    onDone: (addedCount: number) => void;
};

export function SweepStep(props: SweepStepProps) {
    const { text, language } = props;
    const ob = useOnboardingCopy();
    const [phase, setPhase] = useState<'input' | 'loading' | 'review'>('input');
    const [proposal, setProposal] = useState<MindSweepProposal | null>(null);
    const [rows, setRows] = useState<ReviewRow[]>([]);
    const [guide, setGuide] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(false);
    const runId = useRef(0);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (phase === 'input') textareaRef.current?.focus();
    }, [phase]);

    const sort = async () => {
        const value = text.trim();
        if (!value) return;
        const id = ++runId.current;
        setPhase('loading');
        let result: MindSweepProposal;
        try {
            result = await props.generateProposal(value, language);
        } catch {
            result = { projects: [], items: [], summary: '', source: 'fallback', fallbackReason: 'failed' };
        }
        if (id !== runId.current) return;
        setProposal(result);
        setRows(result.items.map((item) => ({ ...item, included: true })));
        setPhase('review');
    };

    const included = rows.filter((row) => row.included);

    const add = async () => {
        if (saving || !proposal) return;
        if (included.length === 0 && !guide) return;
        setSaving(true);
        setError(false);
        try {
            let added = 0;
            if (included.length > 0) {
                const items = included.map(({ included: _included, ...item }) => item);
                const result = await props.applyProposal({ projects: proposal.projects, items });
                added += result.taskIds.length + result.projectIds.length;
                if (result.failed.length > 0 && added === 0) {
                    setError(true);
                    setSaving(false);
                    return;
                }
            }
            if (guide && await props.seedGuide(language)) added += 1;
            props.onDone(added);
        } catch {
            setError(true);
            setSaving(false);
        }
    };

    const skipButton = (
        <Button variant="outline" size="md" onClick={() => props.onDone(0)} disabled={saving}>{ob('onboarding.sweep.skip')}</Button>
    );

    if (phase === 'input') {
        return (
            <div>
                <h2 id="desktop-onboarding-title" className="text-xl font-bold tracking-tight">{ob('onboarding.sweep.title')}</h2>
                <label htmlFor="onboarding-sweep" className="mt-2 block text-sm text-muted-foreground">{ob('onboarding.sweep.prompt')}</label>
                <textarea
                    id="onboarding-sweep"
                    ref={textareaRef}
                    rows={8}
                    value={text}
                    onChange={(event) => props.onTextChange(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
                            event.preventDefault();
                            void sort();
                        }
                    }}
                    placeholder={ob('onboarding.sweep.placeholder')}
                    className="mt-2 w-full resize-none rounded-card bg-well px-4 py-3 text-[15px] shadow-soft-inset placeholder:text-tertiary focus-ring"
                />
                <p className="mt-2 text-xs text-muted-foreground">
                    {props.aiReady ? ob('onboarding.sweep.hintKey') : `${ob('onboarding.sweep.hintManual')} ${ob('onboarding.sweep.hintKey')}`}
                </p>
                <StepFooter
                    onBack={props.onBack}
                    primaryLabel={ob('onboarding.flow.next')}
                    onPrimary={() => void sort()}
                    primaryDisabled={!text.trim()}
                    extra={skipButton}
                />
            </div>
        );
    }

    if (phase === 'loading' || !proposal) {
        return (
            <div>
                <h2 id="desktop-onboarding-title" className="text-xl font-bold tracking-tight">{ob('onboarding.sweep.title')}</h2>
                <div role="status" aria-live="polite" className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    {ob('onboarding.sweep.organising')}
                </div>
                <div className="flex">
                    <Button variant="secondary" size="md" onClick={() => { runId.current += 1; setPhase('input'); }}>{ob('onboarding.flow.back')}</Button>
                </div>
            </div>
        );
    }

    return (
        <div>
            <h2 id="desktop-onboarding-title" className="text-xl font-bold tracking-tight">{ob('onboarding.sweep.reviewTitle')}</h2>
            <div role="status" aria-live="polite">
                {proposal.source === 'ai' && proposal.summary ? (
                    <p className="mt-2 text-sm text-muted-foreground">{proposal.summary}</p>
                ) : null}
                {proposal.source === 'fallback' ? (
                    <p className="mt-2 rounded-card bg-well px-3 py-2 text-[13px] text-muted-foreground">
                        {proposal.fallbackReason === 'failed' ? ob('onboarding.sweep.failedNote') : ob('onboarding.sweep.manualNote')}
                    </p>
                ) : null}
            </div>
            <div className="mt-3">
                <ProposalReview proposal={proposal} rows={rows} onChange={setRows} />
            </div>
            <label className="mt-4 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={guide} onChange={(event) => setGuide(event.target.checked)} />
                {ob('onboarding.sweep.guide')}
            </label>
            <div role="alert" className="min-h-[18px] text-[13px] text-danger-text">{error ? ob('onboarding.sweep.addFailed') : ''}</div>
            <StepFooter
                onBack={() => { setPhase('input'); setError(false); }}
                primaryLabel={saving ? ob('onboarding.sweep.adding') : ob('onboarding.sweep.add')}
                onPrimary={() => void add()}
                primaryDisabled={saving || (included.length === 0 && !guide)}
                extra={skipButton}
            />
        </div>
    );
}
