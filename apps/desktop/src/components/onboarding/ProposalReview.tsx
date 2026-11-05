import type { MindSweepKind, MindSweepProposal, MindSweepProposalItem } from '@stride/core';
import { useOnboardingCopy } from './copy';

export type ReviewRow = MindSweepProposalItem & { included: boolean };

const KINDS: MindSweepKind[] = ['next', 'waiting', 'calendar', 'someday', 'reference', 'inbox'];
const KIND_LABEL: Record<MindSweepKind, string> = {
    next: 'Next action', waiting: 'Waiting for', calendar: 'Calendar', someday: 'Someday', reference: 'Reference', inbox: 'Inbox',
};

/** Untick/edit list for a mind-sweep proposal (the proposal itself comes from the shared Quick Capture engine). */
export function ProposalReview({
    proposal,
    rows,
    onChange,
}: {
    proposal: MindSweepProposal;
    rows: ReviewRow[];
    onChange: (rows: ReviewRow[]) => void;
}) {
    const ob = useOnboardingCopy();
    const projectTitle = (ref?: string) => proposal.projects.find((p) => p.ref === ref)?.title;
    const update = (key: string, patch: Partial<ReviewRow>) => (
        onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)))
    );
    if (rows.length === 0) return <p className="text-sm text-muted-foreground">{ob('onboarding.sweep.empty')}</p>;
    return (
        <ul className="max-h-[38vh] space-y-2 overflow-y-auto pr-1">
            {rows.map((row) => {
                const project = projectTitle(row.projectRef) ?? row.projectName;
                return (
                    <li key={row.key} className="flex flex-wrap items-center gap-2 rounded-card bg-card px-3 py-2 shadow-soft-sm">
                        <input
                            type="checkbox"
                            checked={row.included}
                            onChange={(event) => update(row.key, { included: event.target.checked })}
                            aria-label={`${ob('onboarding.sweep.include')}: ${row.title}`}
                        />
                        <input
                            value={row.title}
                            onChange={(event) => update(row.key, { title: event.target.value })}
                            aria-label={ob('onboarding.sweep.taskTitle')}
                            className={`min-w-[8rem] flex-1 rounded-control bg-transparent px-2 py-1 text-sm font-semibold hover:bg-well focus-ring ${row.included ? '' : 'text-muted-foreground line-through'}`}
                        />
                        {project ? <span className="rounded-pill bg-well px-2.5 py-0.5 text-xs text-muted-foreground">{project}</span> : null}
                        {proposal.source === 'ai' ? (
                            <select
                                value={row.kind}
                                onChange={(event) => update(row.key, { kind: event.target.value as MindSweepKind })}
                                aria-label={ob('onboarding.sweep.kind')}
                                className="rounded-control bg-well px-2 py-1 text-xs focus-ring"
                            >
                                {KINDS.map((kind) => <option key={kind} value={kind}>{KIND_LABEL[kind]}</option>)}
                            </select>
                        ) : null}
                    </li>
                );
            })}
        </ul>
    );
}
