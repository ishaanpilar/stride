import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, Loader2, Sparkles } from 'lucide-react';
import {
    formatI18nTemplate,
    projectOrderHasChanges,
    tFallback,
    useTaskStore,
    type Language,
    type Project,
    type ProjectOrderDependency,
    type ProjectOrderProposal,
} from '@stride/core';

import { generateProjectOrder, type AiOrganiseFailure } from '../../lib/ai-organise-generate';
import { applyProjectOrderSelection, undoAiOrganise } from '../../lib/ai-organise-service';
import { reportError } from '../../lib/report-error';
import { showUndoToast } from '../../lib/undo-registry';
import { useUiStore } from '../../store/ui-store';
import { Button } from '../ui/Button';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '../ui/Dialog';

type Translate = (key: string) => string;

export const aiOrganiseFailureText = (t: Translate, reason: AiOrganiseFailure): string => {
    switch (reason) {
        case 'disabled': return tFallback(t, 'aiOrganise.disabled', 'AI is off. Turn it on in Settings to use this.');
        case 'limited': return tFallback(t, 'aiOrganise.limited', 'Too many AI requests just now. Try again in a minute.');
        case 'empty': return tFallback(t, 'aiOrganise.empty', 'There isn’t enough here to organise yet.');
        default: return tFallback(t, 'aiOrganise.failed', 'Couldn’t get a suggestion right now. Nothing was changed.');
    }
};

const depKey = (dependency: ProjectOrderDependency): string => `${dependency.taskId}|${dependency.blockerId}`;

export type ProjectOrderSheetProps = {
    project: Project;
    language: Language;
    t: Translate;
    onClose: () => void;
    generate?: typeof generateProjectOrder;
};

/** Review sheet for "Order this project": nothing changes until Apply, and Apply is one undoable batch. */
export function ProjectOrderSheet({ project, language, t, onClose, generate = generateProjectOrder }: ProjectOrderSheetProps) {
    const headingId = useId();
    const [proposal, setProposal] = useState<ProjectOrderProposal | null>(null);
    const [failure, setFailure] = useState<AiOrganiseFailure | null>(null);
    const [applying, setApplying] = useState(false);
    const [useOrder, setUseOrder] = useState(true);
    const [skippedDeps, setSkippedDeps] = useState<ReadonlySet<string>>(new Set());
    const [useNextActionOnly, setUseNextActionOnly] = useState(true);
    const startedRef = useRef(false);
    const activeRef = useRef(true);
    const showToast = useUiStore((state) => state.showToast);

    useEffect(() => {
        activeRef.current = true;
        return () => { activeRef.current = false; };
    }, []);

    useEffect(() => {
        if (startedRef.current) return;
        startedRef.current = true;
        void generate(project.id, language).then((outcome) => {
            if (!activeRef.current) return;
            if (outcome.status === 'ok') setProposal(outcome.proposal);
            else setFailure(outcome.reason);
        });
    }, [generate, language, project.id]);

    const titles = useMemo(() => {
        if (!proposal) return new Map<string, string>();
        return new Map(useTaskStore.getState()._allTasks.map((task) => [task.id, task.title]));
    }, [proposal]);
    const titleOf = (id: string) => titles.get(id) ?? '';

    const nextActionOnlyDiffers = proposal !== null && proposal.recommendNextActionOnly !== (project.isSequential === true);
    const acceptedDeps = proposal?.dependencies.filter((dependency) => !skippedDeps.has(depKey(dependency))) ?? [];
    const canApply = proposal !== null && ((useOrder && proposal.orderChanged) || acceptedDeps.length > 0 || (useNextActionOnly && nextActionOnlyDiffers));
    const nothingToDo = proposal !== null && !projectOrderHasChanges(proposal, project);

    const toggleDep = (dependency: ProjectOrderDependency, accepted: boolean) => {
        setSkippedDeps((current) => {
            const next = new Set(current);
            if (accepted) next.delete(depKey(dependency));
            else next.add(depKey(dependency));
            return next;
        });
    };

    const apply = async () => {
        if (!proposal || !canApply) return;
        setApplying(true);
        try {
            const label = formatI18nTemplate(tFallback(t, 'aiOrganise.ordered', 'Ordered “{{title}}”'), { title: project.title });
            const result = await applyProjectOrderSelection(proposal, {
                applyOrder: useOrder && proposal.orderChanged,
                dependencies: acceptedDeps,
                applyNextActionOnly: useNextActionOnly && nextActionOnlyDiffers,
            }, label);
            const { changeId } = result;
            if (changeId) {
                showUndoToast(label, () => {
                    void undoAiOrganise(changeId).then((ok) => {
                        if (!ok) showToast(tFallback(t, 'task.updateFailed', 'Could not update task.'), 'error');
                    }).catch((error) => reportError('Failed to undo project order', error));
                }, t);
            } else {
                showToast(tFallback(t, 'task.updateFailed', 'Could not update task.'), 'error');
            }
            if (activeRef.current) onClose();
        } catch (error) {
            reportError('Failed to apply project order', error);
            showToast(tFallback(t, 'task.updateFailed', 'Could not update task.'), 'error');
            if (activeRef.current) setApplying(false);
        }
    };

    return (
        <Dialog onClose={applying ? () => undefined : onClose} labelledBy={headingId} panelClassName="max-w-xl">
            <DialogHeader className="flex items-start gap-3 border-b border-border px-5 py-4">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-accent-text" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                    <h2 id={headingId} className="text-[17px] font-semibold text-foreground">
                        {tFallback(t, 'aiOrganise.orderProject', 'Order this project')}
                    </h2>
                    <p className="truncate text-[13px] text-muted-foreground">{project.title}</p>
                </div>
            </DialogHeader>
            <DialogBody className="px-5 py-4">
                {!proposal && !failure && (
                    <p className="flex items-center gap-2 text-[14px] text-muted-foreground" role="status">
                        <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                        {tFallback(t, 'aiOrganise.orderThinking', 'Working out what has to happen first…')}
                    </p>
                )}
                {failure && (
                    <p className="text-[14px] text-muted-foreground" role="status" data-testid="project-order-failure">
                        {aiOrganiseFailureText(t, failure)}
                    </p>
                )}
                {proposal && (
                    <div className="flex flex-col gap-3">
                        <p className="text-[14px] text-muted-foreground" data-testid="project-order-summary">
                            {proposal.independent
                                ? tFallback(t, 'aiOrganise.anyOrder', 'These can be done in any order.')
                                : proposal.summary}
                        </p>
                        {proposal.orderChanged ? (
                            <label className="flex cursor-pointer items-center gap-2.5 text-[14px] font-medium text-foreground">
                                <input
                                    type="checkbox"
                                    checked={useOrder}
                                    disabled={applying}
                                    onChange={(event) => setUseOrder(event.target.checked)}
                                    className="focus-ring h-[18px] w-[18px] shrink-0 cursor-pointer rounded accent-[hsl(var(--accent))]"
                                    data-testid="project-order-use-order"
                                />
                                {tFallback(t, 'aiOrganise.useOrder', 'Use this order')}
                            </label>
                        ) : (
                            <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
                                <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                {tFallback(t, 'aiOrganise.alreadyOrdered', 'Already in a good order.')}
                            </p>
                        )}
                        <ol className="flex flex-col gap-1.5" data-testid="project-order-list">
                            {proposal.order.map((id, index) => (
                                <li key={id} className="rounded-control bg-card px-3 py-2 shadow-soft-sm">
                                    <div className="flex items-baseline gap-2.5">
                                        <span className="w-5 shrink-0 text-right text-[13px] tabular-nums text-tertiary">{index + 1}</span>
                                        <span className="min-w-0 text-[14px] text-foreground">{titleOf(id)}</span>
                                    </div>
                                    {proposal.dependencies.filter((dependency) => dependency.taskId === id).map((dependency) => (
                                        <label key={depKey(dependency)} className="mt-1 flex cursor-pointer items-start gap-2 pl-[30px] text-[13px] text-muted-foreground">
                                            <input
                                                type="checkbox"
                                                checked={!skippedDeps.has(depKey(dependency))}
                                                disabled={applying}
                                                onChange={(event) => toggleDep(dependency, event.target.checked)}
                                                aria-label={formatI18nTemplate(tFallback(t, 'aiOrganise.waitFor', 'Wait for “{{title}}”'), { title: titleOf(dependency.blockerId) })}
                                                className="focus-ring mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded accent-[hsl(var(--accent))]"
                                                data-testid="project-order-dependency"
                                            />
                                            <span>
                                                {formatI18nTemplate(tFallback(t, 'aiOrganise.after', 'after: {{title}}'), { title: titleOf(dependency.blockerId) })}
                                                {dependency.reason ? ` · ${dependency.reason}` : ''}
                                            </span>
                                        </label>
                                    ))}
                                </li>
                            ))}
                        </ol>
                        {nextActionOnlyDiffers && (
                            <label className="flex cursor-pointer items-start gap-2.5 rounded-control bg-well px-3 py-2.5 shadow-soft-inset">
                                <input
                                    type="checkbox"
                                    checked={useNextActionOnly}
                                    disabled={applying}
                                    onChange={(event) => setUseNextActionOnly(event.target.checked)}
                                    className="focus-ring mt-0.5 h-[18px] w-[18px] shrink-0 cursor-pointer rounded accent-[hsl(var(--accent))]"
                                    data-testid="project-order-next-action-only"
                                />
                                <span className="min-w-0">
                                    <span className="block text-[14px] font-medium text-foreground">
                                        {proposal.recommendNextActionOnly
                                            ? tFallback(t, 'aiOrganise.nextActionOnlyOn', 'Turn on Next action only')
                                            : tFallback(t, 'aiOrganise.nextActionOnlyOff', 'Turn off Next action only')}
                                    </span>
                                    <span className="block text-[13px] text-muted-foreground">
                                        {tFallback(t, 'projects.nextActionOnlyHint', "Only this project's next step shows in Focus; later steps wait their turn.")}
                                    </span>
                                </span>
                            </label>
                        )}
                    </div>
                )}
            </DialogBody>
            <DialogFooter className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
                <Button variant="secondary" size="md" onClick={onClose} disabled={applying}>
                    {proposal && !nothingToDo ? tFallback(t, 'common.cancel', 'Cancel') : tFallback(t, 'common.close', 'Close')}
                </Button>
                {proposal && !nothingToDo && (
                    <Button variant="primary" size="md" onClick={() => { void apply(); }} loading={applying} disabled={!canApply || applying} data-testid="project-order-apply">
                        {tFallback(t, 'aiOrganise.apply', 'Apply')}
                    </Button>
                )}
            </DialogFooter>
        </Dialog>
    );
}
