import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import {
    formatI18nTemplate,
    tFallback,
    useTaskStore,
    type Language,
    type Task,
    type TaskGroupingGroup,
    type TaskGroupingProposal,
} from '@stride/core';

import { generateLooseGrouping, type AiOrganiseFailure } from '../../lib/ai-organise-generate';
import { applyLooseGrouping, undoAiOrganise } from '../../lib/ai-organise-service';
import { reportError } from '../../lib/report-error';
import { showUndoToast } from '../../lib/undo-registry';
import { useUiStore } from '../../store/ui-store';
import { Button } from '../ui/Button';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '../ui/Dialog';
import { Pill } from '../ui/Pill';
import { aiOrganiseFailureText } from './ProjectOrderSheet';

type Translate = (key: string) => string;

export type LooseGroupingSheetProps = {
    tasks: readonly Task[];
    language: Language;
    t: Translate;
    onClose: () => void;
    generate?: typeof generateLooseGrouping;
};

type GroupRow = TaskGroupingGroup & { accepted: boolean };

/** Review sheet for "Group these": per-group accept, rename or skip; Apply is one undoable batch. */
export function LooseGroupingSheet({ tasks, language, t, onClose, generate = generateLooseGrouping }: LooseGroupingSheetProps) {
    const headingId = useId();
    const [proposal, setProposal] = useState<TaskGroupingProposal | null>(null);
    const [rows, setRows] = useState<GroupRow[]>([]);
    const [failure, setFailure] = useState<AiOrganiseFailure | null>(null);
    const [applying, setApplying] = useState(false);
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
        void generate(tasks, language).then((outcome) => {
            if (!activeRef.current) return;
            if (outcome.status === 'ok') {
                setProposal(outcome.proposal);
                setRows(outcome.proposal.groups.map((group) => ({ ...group, accepted: true })));
            } else {
                setFailure(outcome.reason);
            }
        });
    }, [generate, language, tasks]);

    const titles = useMemo(() => {
        if (!proposal) return new Map<string, string>();
        return new Map(useTaskStore.getState()._allTasks.map((task) => [task.id, task.title]));
    }, [proposal]);

    const updateRow = (key: string, patch: Partial<GroupRow>) => {
        setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
    };

    const accepted = rows.filter((row) => row.accepted && row.title.trim());
    const nothingToGroup = proposal !== null && proposal.groups.length === 0;

    const apply = async () => {
        if (accepted.length === 0) return;
        setApplying(true);
        try {
            const count = accepted.reduce((sum, row) => sum + row.taskIds.length, 0);
            const label = formatI18nTemplate(tFallback(t, 'aiOrganise.grouped', 'Grouped {{count}} tasks into projects'), { count });
            const result = await applyLooseGrouping(accepted.map(({ accepted: _accepted, ...group }) => group), label);
            const { changeId } = result;
            if (changeId) {
                showUndoToast(label, () => {
                    void undoAiOrganise(changeId).then((ok) => {
                        if (!ok) showToast(tFallback(t, 'task.updateFailed', 'Could not update task.'), 'error');
                    }).catch((error) => reportError('Failed to undo grouping', error));
                }, t);
            } else {
                showToast(tFallback(t, 'task.updateFailed', 'Could not update task.'), 'error');
            }
            if (activeRef.current) onClose();
        } catch (error) {
            reportError('Failed to apply grouping', error);
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
                        {tFallback(t, 'aiOrganise.groupTitle', 'Group loose tasks')}
                    </h2>
                    {proposal?.summary ? <p className="text-[13px] text-muted-foreground">{proposal.summary}</p> : null}
                </div>
            </DialogHeader>
            <DialogBody className="px-5 py-4">
                {!proposal && !failure && (
                    <p className="flex items-center gap-2 text-[14px] text-muted-foreground" role="status">
                        <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                        {tFallback(t, 'aiOrganise.groupThinking', 'Looking for tasks that belong together…')}
                    </p>
                )}
                {failure && (
                    <p className="text-[14px] text-muted-foreground" role="status" data-testid="loose-grouping-failure">
                        {aiOrganiseFailureText(t, failure)}
                    </p>
                )}
                {nothingToGroup && (
                    <p className="text-[14px] text-muted-foreground" role="status">
                        {tFallback(t, 'aiOrganise.nothingToGroup', 'Nothing here belongs together yet. These can stay as they are.')}
                    </p>
                )}
                {proposal && rows.length > 0 && (
                    <div className="flex flex-col gap-2.5" data-testid="loose-grouping-groups">
                        {rows.map((row) => (
                            <div key={row.key} className={`rounded-card bg-card p-3 shadow-soft-sm transition-opacity duration-200 motion-reduce:transition-none ${row.accepted ? '' : 'opacity-60'}`} data-testid="loose-grouping-group">
                                <div className="flex items-center gap-2.5">
                                    <input
                                        type="checkbox"
                                        checked={row.accepted}
                                        disabled={applying}
                                        onChange={(event) => updateRow(row.key, { accepted: event.target.checked })}
                                        aria-label={formatI18nTemplate(tFallback(t, 'aiOrganise.acceptGroup', 'Accept “{{title}}”'), { title: row.title })}
                                        className="focus-ring h-[18px] w-[18px] shrink-0 cursor-pointer rounded accent-[hsl(var(--accent))]"
                                    />
                                    <input
                                        type="text"
                                        value={row.title}
                                        disabled={applying || row.existing}
                                        onChange={(event) => updateRow(row.key, { title: event.target.value })}
                                        aria-label={tFallback(t, 'aiOrganise.projectName', 'Project name')}
                                        className="focus-ring min-w-0 flex-1 rounded-control bg-transparent px-1.5 py-1 text-[15px] font-semibold text-foreground hover:bg-well disabled:hover:bg-transparent"
                                    />
                                </div>
                                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-[28px]">
                                    <Pill tone={row.existing ? 'neutral' : 'accent'}>
                                        {row.existing
                                            ? tFallback(t, 'aiOrganise.existingProject', 'Existing project')
                                            : tFallback(t, 'aiOrganise.newProject', 'New project')}
                                    </Pill>
                                    {row.areaName ? <Pill>{row.areaName}</Pill> : null}
                                    {row.reason ? <span className="text-[13px] text-muted-foreground">{row.reason}</span> : null}
                                </div>
                                <ul className="mt-2 space-y-0.5 pl-[28px] text-[14px] text-foreground">
                                    {row.taskIds.map((id) => <li key={id}>{titles.get(id)}</li>)}
                                </ul>
                            </div>
                        ))}
                        {proposal.stayLooseTaskIds.length > 0 && (
                            <p className="px-1 text-[13px] text-muted-foreground">
                                {formatI18nTemplate(tFallback(t, 'aiOrganise.stayLoose', 'Staying loose: {{titles}}'), {
                                    titles: proposal.stayLooseTaskIds.map((id) => titles.get(id)).filter(Boolean).join(', '),
                                })}
                            </p>
                        )}
                    </div>
                )}
            </DialogBody>
            <DialogFooter className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
                <Button variant="secondary" size="md" onClick={onClose} disabled={applying}>
                    {proposal && !nothingToGroup ? tFallback(t, 'common.cancel', 'Cancel') : tFallback(t, 'common.close', 'Close')}
                </Button>
                {proposal && !nothingToGroup && (
                    <Button variant="primary" size="md" onClick={() => { void apply(); }} loading={applying} disabled={accepted.length === 0 || applying} data-testid="loose-grouping-apply">
                        {tFallback(t, 'aiOrganise.apply', 'Apply')}
                    </Button>
                )}
            </DialogFooter>
        </Dialog>
    );
}
