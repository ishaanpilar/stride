import { useId, useMemo, useState } from 'react';
import { Check, Pencil, Sparkles } from 'lucide-react';
import type { InboxProcessKind, InboxProcessSuggestion } from '@stride/core';

import { cn } from '../../../lib/utils';
import { Button } from '../../ui/Button';
import { Pill } from '../../ui/Pill';
import type { CaptureText } from '../../capture/useCaptureText';
import type { InboxAiProcessController, InboxReviewRow } from './useInboxAiProcess';

type GroupId = InboxProcessKind | 'needsYou';
const GROUP_ORDER: GroupId[] = ['next', 'project', 'calendar', 'waiting', 'someday', 'reference', 'delete', 'needsYou'];

export const inboxKindLabel = (t: CaptureText, kind: InboxProcessKind): string => {
    switch (kind) {
        case 'next': return t('inboxHub.kind.next', 'Next action');
        case 'project': return t('inboxHub.kind.project', 'New project');
        case 'waiting': return t('inboxHub.kind.waiting', 'Waiting for');
        case 'someday': return t('inboxHub.kind.someday', 'Someday');
        case 'reference': return t('inboxHub.kind.reference', 'Reference');
        case 'calendar': return t('inboxHub.kind.calendar', 'Calendar');
        case 'delete': return t('inboxHub.kind.delete', 'Delete');
    }
};

const groupLabel = (t: CaptureText, id: GroupId): string => {
    switch (id) {
        case 'next': return t('inboxHub.group.next', 'Next actions');
        case 'project': return t('inboxHub.group.project', 'Projects');
        case 'calendar': return t('inboxHub.group.calendar', 'Calendar');
        case 'waiting': return t('inboxHub.group.waiting', 'Waiting for');
        case 'someday': return t('inboxHub.group.someday', 'Someday');
        case 'reference': return t('inboxHub.group.reference', 'Reference');
        case 'delete': return t('inboxHub.group.delete', 'Delete or duplicate');
        case 'needsYou': return t('inboxHub.group.needsYou', 'Needs you');
    }
};

const formatWhen = (value: string): string => {
    const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
    if (Number.isNaN(date.getTime())) return value;
    return value.length === 10
        ? date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
        : date.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
};

export type InboxProcessReviewProps = {
    t: CaptureText;
    controller: InboxAiProcessController;
    projectNames: string[];
    areaNames: string[];
    /** Title of a task by id (for "duplicate of"). */
    titleFor: (taskId: string) => string | undefined;
};

export function InboxProcessReview({ t, controller, projectNames, areaNames, titleFor }: InboxProcessReviewProps) {
    const { rows, summary, acceptedCount, phase } = controller;
    const [editing, setEditing] = useState<string | null>(null);
    const headingId = useId();
    const groups = useMemo(() => {
        const byGroup = new Map<GroupId, InboxReviewRow[]>();
        for (const row of rows) {
            const id: GroupId = row.needsYou ? 'needsYou' : row.kind;
            byGroup.set(id, [...(byGroup.get(id) ?? []), row]);
        }
        return GROUP_ORDER.filter((id) => byGroup.has(id)).map((id) => ({ id, rows: byGroup.get(id)! }));
    }, [rows]);
    const applying = phase === 'applying';

    return (
        <section aria-labelledby={headingId} className="motion-expand-in flex flex-col gap-4 pb-6" data-inbox-review>
            <div className="flex flex-wrap items-center gap-3 rounded-card bg-well px-4 py-3 shadow-soft-inset">
                <Sparkles className="h-4 w-4 shrink-0 text-accent-text" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                    <h2 id={headingId} className="text-[15px] font-semibold text-foreground">
                        {t('inboxHub.reviewTitle', 'Review the AI’s suggestions')}
                    </h2>
                    <p className="text-[13px] text-muted-foreground">
                        {summary || t('inboxHub.reviewHint', 'Nothing changes until you apply. Items you skip stay in the Inbox.')}
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={controller.cancel} disabled={applying}>
                        {t('common.cancel', 'Cancel')}
                    </Button>
                    <Button variant="secondary" size="sm" onClick={controller.acceptAll} disabled={applying} data-inbox-accept-all>
                        {t('inboxHub.acceptAll', 'Accept all')}
                    </Button>
                    <Button
                        variant="primary"
                        size="sm"
                        onClick={() => { void controller.applyAccepted(); }}
                        loading={applying}
                        disabled={applying}
                        data-inbox-apply
                    >
                        {acceptedCount > 0
                            ? t('inboxHub.applyCount', 'Apply {{count}}', { count: acceptedCount })
                            : t('inboxHub.done', 'Done')}
                    </Button>
                </div>
            </div>

            {groups.map((group) => (
                <div key={group.id} className="flex flex-col gap-2" role="group" aria-label={groupLabel(t, group.id)}>
                    <h3 className="flex items-center gap-2 px-1 text-[13px] font-semibold text-muted-foreground">
                        {groupLabel(t, group.id)}
                        <span className="font-normal tabular-nums text-tertiary">{group.rows.length}</span>
                    </h3>
                    {group.id === 'needsYou' ? (
                        <p className="px-1 text-[13px] text-muted-foreground">
                            {t('inboxHub.needsYouHint', 'The AI wasn’t sure about these. They stay in the Inbox unless you edit or accept them.')}
                        </p>
                    ) : null}
                    <ul className="flex flex-col gap-2">
                        {group.rows.map((row) => (
                            <ReviewRow
                                key={row.taskId}
                                t={t}
                                row={row}
                                editing={editing === row.taskId}
                                onEdit={() => setEditing(editing === row.taskId ? null : row.taskId)}
                                onCloseEdit={() => setEditing(null)}
                                controller={controller}
                                projectNames={projectNames}
                                areaNames={areaNames}
                                duplicateTitle={row.duplicateOf ? titleFor(row.duplicateOf) : undefined}
                                afterTitle={row.blockedByTaskId ? titleFor(row.blockedByTaskId) : undefined}
                                disabled={applying}
                            />
                        ))}
                    </ul>
                </div>
            ))}
        </section>
    );
}

type ReviewRowProps = {
    t: CaptureText;
    row: InboxReviewRow;
    editing: boolean;
    onEdit: () => void;
    onCloseEdit: () => void;
    controller: InboxAiProcessController;
    projectNames: string[];
    areaNames: string[];
    duplicateTitle?: string;
    afterTitle?: string;
    disabled: boolean;
};

function ReviewRow({ t, row, editing, onEdit, onCloseEdit, controller, projectNames, areaNames, duplicateTitle, afterTitle, disabled }: ReviewRowProps) {
    const accepted = row.decision === 'accept';
    const checkboxId = useId();
    const projectLabel = row.projectName ?? row.newProjectTitle;
    const areaLabel = row.areaName ?? row.newAreaName;
    return (
        <li
            className={cn(
                'rounded-card bg-card px-4 py-3 shadow-soft-sm transition-opacity duration-200 motion-reduce:transition-none',
                !accepted && 'opacity-70',
            )}
            data-inbox-review-row={row.taskId}
            data-decision={row.decision}
        >
            <div className="flex items-start gap-3">
                <input
                    id={checkboxId}
                    type="checkbox"
                    checked={accepted}
                    disabled={disabled}
                    onChange={(event) => controller.setDecision(row.taskId, event.target.checked ? 'accept' : 'skip')}
                    className="focus-ring mt-0.5 h-[18px] w-[18px] shrink-0 cursor-pointer rounded accent-[hsl(var(--accent))]"
                    aria-label={accepted
                        ? t('inboxHub.skipItem', 'Skip “{{title}}”', { title: row.title })
                        : t('inboxHub.acceptItem', 'Accept “{{title}}”', { title: row.title })}
                />
                <div className="min-w-0 flex-1">
                    <label htmlFor={checkboxId} className="block cursor-pointer text-[15px] font-semibold leading-5 text-foreground">
                        {row.title}
                    </label>
                    {row.title !== row.originalTitle ? (
                        <p className="mt-0.5 truncate text-[13px] text-tertiary">
                            {t('inboxHub.wasTitle', 'Captured as “{{title}}”', { title: row.originalTitle })}
                        </p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {/* The project / waiting chips already say what it is; skip the redundant kind chip there. */}
                        {(row.kind === 'project' && projectLabel) || (row.kind === 'waiting' && row.waitingFor) ? null : (
                            <Pill tone={row.kind === 'delete' ? 'danger' : 'accent'}>{inboxKindLabel(t, row.kind)}</Pill>
                        )}
                        {projectLabel ? (
                            <Pill dot>
                                {row.newProjectTitle && !row.projectName
                                    ? t('inboxHub.newProjectChip', 'New project: {{name}}', { name: projectLabel })
                                    : projectLabel}
                            </Pill>
                        ) : null}
                        {afterTitle ? <Pill>{t('inboxHub.afterChip', 'After: {{title}}', { title: afterTitle })}</Pill> : null}
                        {areaLabel ? (
                            <Pill tone={row.newAreaName && !row.areaName ? 'warning' : 'neutral'}>
                                {row.newAreaName && !row.areaName
                                    ? t('inboxHub.newAreaChip', 'New area: {{name}}', { name: areaLabel })
                                    : areaLabel}
                            </Pill>
                        ) : null}
                        {row.waitingFor ? <Pill>{t('inboxHub.waitingChip', 'Waiting on {{name}}', { name: row.waitingFor })}</Pill> : null}
                        {row.startTime ? <Pill tone="today">{formatWhen(row.startTime)}</Pill> : null}
                        {row.dueDate ? <Pill tone="warning">{t('inboxHub.dueChip', 'Due {{date}}', { date: formatWhen(row.dueDate) })}</Pill> : null}
                        {row.priority ? <Pill tone={row.priority === 'high' || row.priority === 'urgent' ? 'danger' : 'neutral'}>{row.priority}</Pill> : null}
                        {row.timeEstimate ? <Pill>{row.timeEstimate}</Pill> : null}
                        {[...(row.contexts ?? []), ...(row.tags ?? [])].map((token) => <Pill key={token}>{token}</Pill>)}
                        {duplicateTitle ? <Pill tone="danger">{t('inboxHub.duplicateOf', 'Duplicate of “{{title}}”', { title: duplicateTitle })}</Pill> : null}
                    </div>
                    {row.reason ? (
                        <p className="mt-1.5 text-[13px] text-muted-foreground">{t('quickCapture.reason', 'Why: {{reason}}', { reason: row.reason })}</p>
                    ) : null}
                </div>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={onEdit}
                    disabled={disabled}
                    aria-expanded={editing}
                    leadingIcon={<Pencil className="h-3.5 w-3.5" aria-hidden="true" />}
                >
                    {t('common.edit', 'Edit')}
                </Button>
            </div>
            {editing ? (
                <ReviewRowEditor
                    t={t}
                    row={row}
                    projectNames={projectNames}
                    areaNames={areaNames}
                    onSave={(patch) => { controller.updateRow(row.taskId, patch); onCloseEdit(); }}
                    onCancel={onCloseEdit}
                />
            ) : null}
        </li>
    );
}

const NONE = '';
const NEW_PREFIX = 'new:';
const selectClass = 'h-8 min-w-0 max-w-full rounded-control border border-border bg-card px-2 text-[13px] text-foreground focus-ring';

function ReviewRowEditor({ t, row, projectNames, areaNames, onSave, onCancel }: {
    t: CaptureText;
    row: InboxReviewRow;
    projectNames: string[];
    areaNames: string[];
    onSave: (patch: Partial<InboxProcessSuggestion>) => void;
    onCancel: () => void;
}) {
    const [title, setTitle] = useState(row.title);
    const [kind, setKind] = useState<InboxProcessKind>(row.kind);
    const [project, setProject] = useState(row.projectName ?? (row.newProjectTitle ? `${NEW_PREFIX}${row.newProjectTitle}` : NONE));
    const [newProject, setNewProject] = useState(row.newProjectTitle ?? '');
    const [area, setArea] = useState(row.areaName ?? (row.newAreaName ? `${NEW_PREFIX}${row.newAreaName}` : NONE));
    const [waitingFor, setWaitingFor] = useState(row.waitingFor ?? '');
    const ids = { title: useId(), kind: useId(), project: useId(), area: useId(), person: useId() };
    const isNewProject = project.startsWith(NEW_PREFIX);

    const save = () => {
        const trimmed = title.trim();
        if (!trimmed) return;
        const patch: Partial<InboxProcessSuggestion> = { title: trimmed, kind };
        if (kind === 'delete' || kind === 'reference') {
            Object.assign(patch, { projectName: undefined, newProjectTitle: undefined });
        } else if (isNewProject) {
            Object.assign(patch, { projectName: undefined, newProjectTitle: newProject.trim() || undefined });
        } else {
            Object.assign(patch, { projectName: project || undefined, newProjectTitle: undefined });
        }
        if (area.startsWith(NEW_PREFIX)) Object.assign(patch, { areaName: undefined, newAreaName: area.slice(NEW_PREFIX.length) });
        else Object.assign(patch, { areaName: area || undefined, newAreaName: undefined });
        patch.waitingFor = kind === 'waiting' ? (waitingFor.trim() || undefined) : undefined;
        if (kind !== 'delete') patch.duplicateOf = undefined;
        onSave(patch);
    };

    return (
        <form
            className="mt-3 grid gap-3 rounded-control bg-well p-3 sm:grid-cols-2"
            onSubmit={(event) => { event.preventDefault(); save(); }}
        >
            <label className="flex flex-col gap-1 text-[12px] font-medium text-muted-foreground sm:col-span-2" htmlFor={ids.title}>
                {t('quickCapture.taskTitle', 'Task title')}
                <input id={ids.title} value={title} onChange={(e) => setTitle(e.target.value)} className="h-8 rounded-control border border-border bg-card px-2 text-[14px] text-foreground focus-ring" />
            </label>
            <label className="flex flex-col gap-1 text-[12px] font-medium text-muted-foreground" htmlFor={ids.kind}>
                {t('quickCapture.kind', 'Type')}
                <select id={ids.kind} value={kind} onChange={(e) => setKind(e.target.value as InboxProcessKind)} className={selectClass}>
                    {(['next', 'project', 'calendar', 'waiting', 'someday', 'reference', 'delete'] as InboxProcessKind[]).map((k) => (
                        <option key={k} value={k}>{inboxKindLabel(t, k)}</option>
                    ))}
                </select>
            </label>
            {kind !== 'delete' && kind !== 'reference' ? (
                <label className="flex flex-col gap-1 text-[12px] font-medium text-muted-foreground" htmlFor={ids.project}>
                    {t('inboxHub.projectField', 'Project')}
                    <select id={ids.project} value={project} onChange={(e) => setProject(e.target.value)} className={selectClass}>
                        <option value={NONE}>{t('inboxHub.noProject', 'No project')}</option>
                        <option value={`${NEW_PREFIX}${newProject}`}>{t('inboxHub.newProjectOption', 'New project…')}</option>
                        {projectNames.map((name) => <option key={name} value={name}>{name}</option>)}
                    </select>
                </label>
            ) : null}
            {isNewProject && kind !== 'delete' && kind !== 'reference' ? (
                <label className="flex flex-col gap-1 text-[12px] font-medium text-muted-foreground" htmlFor={`${ids.project}-new`}>
                    {t('inboxHub.newProjectName', 'New project name')}
                    <input
                        id={`${ids.project}-new`}
                        value={newProject}
                        onChange={(e) => { setNewProject(e.target.value); setProject(`${NEW_PREFIX}${e.target.value}`); }}
                        className="h-8 rounded-control border border-border bg-card px-2 text-[14px] text-foreground focus-ring"
                    />
                </label>
            ) : null}
            {kind !== 'delete' ? (
                <label className="flex flex-col gap-1 text-[12px] font-medium text-muted-foreground" htmlFor={ids.area}>
                    {t('quickCapture.whichArea', 'Which area?')}
                    <select id={ids.area} value={area} onChange={(e) => setArea(e.target.value)} className={selectClass}>
                        <option value={NONE}>{t('inboxHub.noArea', 'No area')}</option>
                        {row.newAreaName ? <option value={`${NEW_PREFIX}${row.newAreaName}`}>{t('inboxHub.newAreaChip', 'New area: {{name}}', { name: row.newAreaName })}</option> : null}
                        {areaNames.map((name) => <option key={name} value={name}>{name}</option>)}
                    </select>
                </label>
            ) : null}
            {kind === 'waiting' ? (
                <label className="flex flex-col gap-1 text-[12px] font-medium text-muted-foreground" htmlFor={ids.person}>
                    {t('inboxHub.waitingField', 'Waiting on')}
                    <input id={ids.person} value={waitingFor} onChange={(e) => setWaitingFor(e.target.value)} className="h-8 rounded-control border border-border bg-card px-2 text-[14px] text-foreground focus-ring" />
                </label>
            ) : null}
            <div className="flex items-center justify-end gap-2 sm:col-span-2">
                <Button type="button" variant="ghost" size="sm" onClick={onCancel}>{t('common.cancel', 'Cancel')}</Button>
                <Button type="submit" variant="primary" size="sm" leadingIcon={<Check className="h-3.5 w-3.5" aria-hidden="true" />}>
                    {t('inboxHub.saveAndAccept', 'Save and accept')}
                </Button>
            </div>
        </form>
    );
}
