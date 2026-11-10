import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, ChevronRight, GripVertical, Lock, MoreHorizontal, Sparkles } from 'lucide-react';
import {
    formatI18nTemplate,
    getProjectAccentColor,
    tFallback,
    type Area,
    type FocusProjectCard as FocusProjectCardModel,
    type Project,
    type Task,
} from '@stride/core';

import { cn } from '../../../lib/utils';
import { COMPLETION_LEAVE_MS, useCompletionPhase } from '../../../lib/completion-sequence';
import { canAnimate } from '../../../lib/motion';
import { Collapse } from '../../ui/Collapse';
import { ExitGhost } from '../../ui/ExitGhost';
import { ReorderableTaskRow } from '../list/task-reorder';
import { StoreTaskItem, type StoreTaskItemProps } from '../list/StoreTaskItem';

/** Reorder groups for the Projects layout: cards within an area, tasks within a project. */
export const PROJECT_CARD_GROUP_PREFIX = 'project-cards:';
export const PROJECT_TASK_GROUP_PREFIX = 'project-tasks:';
const NO_AREA_GROUP = 'none';

export const projectCardGroupKey = (areaId: string | undefined): string => (
    `${PROJECT_CARD_GROUP_PREFIX}${areaId ?? NO_AREA_GROUP}`
);
export const areaIdFromProjectCardGroup = (groupKey: string): string | undefined => {
    const areaId = groupKey.slice(PROJECT_CARD_GROUP_PREFIX.length);
    return areaId === NO_AREA_GROUP ? undefined : areaId;
};
export const projectIdFromTaskGroup = (groupKey: string): string => groupKey.slice(PROJECT_TASK_GROUP_PREFIX.length);

type BuildFocusToggle = NonNullable<StoreTaskItemProps['buildFocusToggle']>;

export type FocusProjectCardsProps = {
    cards: readonly FocusProjectCardModel[];
    areaById: ReadonlyMap<string, Area>;
    expandedProjectIds: Readonly<Record<string, boolean>>;
    highlightTaskId: string | null;
    showListDetails: boolean;
    dragLabel: string;
    buildFocusToggle: BuildFocusToggle;
    getProjectDeadlineLabel?: (taskId: string) => string | undefined;
    onToggleExpanded: (projectId: string) => void;
    onOpenProject: (projectId: string) => void;
    onNextActionOnlyChange: (project: Project, enabled: boolean) => void;
    /** "Order this project" with AI; the menu item is hidden when undefined (AI off). */
    onOrderProject?: (project: Project) => void;
    t: (key: string) => string;
};

export const isCardExpanded = (
    card: FocusProjectCardModel,
    expandedProjectIds: Readonly<Record<string, boolean>>,
    highlightTaskId: string | null,
): boolean => {
    if (expandedProjectIds[card.project.id]) return true;
    if (!highlightTaskId) return false;
    return [...card.moreActions, ...card.lockedTasks].some((task) => task.id === highlightTaskId);
};

export function FocusProjectCards({
    cards,
    areaById,
    expandedProjectIds,
    highlightTaskId,
    ...rest
}: FocusProjectCardsProps) {
    const cardSiblingsByGroup = useMemo(() => {
        const groups = new Map<string, string[]>();
        for (const card of cards) {
            const key = projectCardGroupKey(card.project.areaId);
            const ids = groups.get(key) ?? [];
            ids.push(card.project.id);
            groups.set(key, ids);
        }
        return groups;
    }, [cards]);

    return (
        <div className="flex flex-col gap-2.5" data-testid="focus-project-cards">
            {cards.map((card) => {
                const groupKey = projectCardGroupKey(card.project.areaId);
                return (
                    <FocusProjectCard
                        key={card.project.id}
                        card={card}
                        color={getProjectAccentColor(card.project, areaById as Map<string, Area>) ?? 'hsl(var(--muted-foreground))'}
                        expanded={isCardExpanded(card, expandedProjectIds, highlightTaskId)}
                        groupKey={groupKey}
                        cardSiblingIds={cardSiblingsByGroup.get(groupKey) ?? []}
                        {...rest}
                    />
                );
            })}
        </div>
    );
}

type FocusProjectCardProps = Omit<FocusProjectCardsProps, 'cards' | 'areaById' | 'expandedProjectIds' | 'highlightTaskId'> & {
    card: FocusProjectCardModel;
    color: string;
    expanded: boolean;
    groupKey: string;
    cardSiblingIds: readonly string[];
};

function FocusProjectCard({
    card,
    color,
    expanded,
    groupKey,
    cardSiblingIds,
    showListDetails,
    dragLabel,
    buildFocusToggle,
    getProjectDeadlineLabel,
    onToggleExpanded,
    onOpenProject,
    onNextActionOnlyChange,
    onOrderProject,
    t,
}: FocusProjectCardProps) {
    const { project, nextAction, moreActions, lockedTasks, doneCount, totalCount } = card;
    const cardRef = useRef<HTMLDivElement | null>(null);
    const controlsId = `focus-project-card-${project.id}`;
    const taskGroupKey = `${PROJECT_TASK_GROUP_PREFIX}${project.id}`;
    const nextActionPhase = useCompletionPhase(nextAction.id);
    const hasMore = moreActions.length > 0 || lockedTasks.length > 0;
    const progressText = formatI18nTemplate(
        tFallback(t, 'agenda.projectProgress', '{{done}} of {{total}}'),
        { done: doneCount, total: totalCount },
    );
    const expandLabel = expanded
        ? tFallback(t, 'agenda.hideNextActions', 'Hide other next actions')
        : tFallback(t, 'agenda.showNextActions', 'Show other next actions');
    const openLabel = `${tFallback(t, 'common.open', 'Open')} ${project.title}`;
    const taskSiblingIds = useMemo(() => (
        [nextAction, ...moreActions, ...lockedTasks]
            .filter((task) => task.status !== 'done')
            .map((task) => task.id)
    ), [lockedTasks, moreActions, nextAction]);

    // A ticked next action plays its sequence in the card; as it leaves, the next task grows in below it.
    const nextOpenTask = moreActions.find((task) => task.status !== 'done');
    const risingTask = !expanded && nextAction.status === 'done'
        && (nextActionPhase === 'leaving' || nextActionPhase === 'gone')
        ? nextOpenTask
        : undefined;

    const renderRow = (task: Task) => (
        <ReorderableTaskRow
            key={task.id}
            taskId={task.id}
            groupKey={taskGroupKey}
            siblingIds={taskSiblingIds}
            enabled={task.status !== 'done'}
            dragLabel={dragLabel}
            leavesForeignDragsToParent
            gripClassName="!-left-[18px]"
        >
            <StoreTaskItem
                taskId={task.id}
                buildFocusToggle={buildFocusToggle}
                showProjectBadgeInActions={false}
                showProjectBadgeInMetadata={false}
                compactMetaEnabled={showListDetails}
                enableDoubleClickEdit
                projectDeadlineLabel={getProjectDeadlineLabel?.(task.id)}
            />
        </ReorderableTaskRow>
    );

    const handleHeaderDragStart = (event: DragEvent<HTMLDivElement>) => {
        if (event.target instanceof Element && event.target.closest('button')) {
            event.preventDefault();
            return;
        }
        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', project.title);
            const element = cardRef.current;
            if (element && typeof event.dataTransfer.setDragImage === 'function') {
                const rect = element.getBoundingClientRect();
                event.dataTransfer.setDragImage(element, event.clientX - rect.left, event.clientY - rect.top);
            }
        }
    };

    const handleTitleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onOpenProject(project.id);
    };

    return (
        <ReorderableTaskRow
            taskId={project.id}
            groupKey={groupKey}
            siblingIds={cardSiblingIds}
            dragLabel={dragLabel}
            nestedGroupKey={taskGroupKey}
            hideGrip
        >
            <div
                ref={cardRef}
                role="group"
                aria-label={`${project.title}, ${progressText}`}
                data-testid="focus-project-card"
                data-project-id={project.id}
                className="group/card relative min-w-0 rounded-card bg-well p-2.5 shadow-soft-inset"
            >
                <div
                    draggable
                    onDragStart={handleHeaderDragStart}
                    className="group/cardheader relative flex min-w-0 items-center gap-1.5 pb-2 pl-0.5 pr-0.5"
                >
                    <span
                        aria-hidden="true"
                        title={dragLabel}
                        className="pointer-events-none absolute -left-5 top-1/2 hidden -translate-y-1/2 text-tertiary opacity-0 transition-opacity duration-200 group-hover/cardheader:opacity-100 sm:block motion-reduce:transition-none"
                    >
                        <GripVertical className="h-4 w-4" />
                    </span>
                    {hasMore ? (
                        <button
                            type="button"
                            aria-expanded={expanded}
                            aria-controls={controlsId}
                            aria-label={`${expandLabel}: ${project.title}`}
                            title={expandLabel}
                            onClick={() => onToggleExpanded(project.id)}
                            className="focus-ring inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-control text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
                        >
                            {expanded ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
                        </button>
                    ) : (
                        <span className="h-6 w-6 shrink-0" aria-hidden="true" />
                    )}
                    <div
                        role="button"
                        tabIndex={0}
                        aria-label={openLabel}
                        title={project.title}
                        onClick={() => onOpenProject(project.id)}
                        onKeyDown={handleTitleKeyDown}
                        className="focus-ring flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-control text-left"
                    >
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
                        <span className="min-w-0 truncate text-sm font-semibold text-foreground">{project.title}</span>
                    </div>
                    <span className="shrink-0 whitespace-nowrap text-[13px] tabular-nums text-muted-foreground">{progressText}</span>
                    <ProjectCardMenu project={project} onNextActionOnlyChange={onNextActionOnlyChange} onOpenProject={onOpenProject} onOrderProject={onOrderProject} t={t} />
                </div>
                <div className="flex flex-col gap-2.5">
                    {renderRow(nextAction)}
                    {risingTask && (
                        <RisingRow key={`rising:${risingTask.id}`}>
                            {renderRow(risingTask)}
                        </RisingRow>
                    )}
                    {hasMore && (
                        <Collapse open={expanded} id={controlsId} unmountWhenClosed innerClassName="-m-1 overflow-hidden p-1">
                            <div className="flex flex-col gap-2.5">
                                {moreActions.map(renderRow)}
                                {lockedTasks.length > 0 && (
                                    <p className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
                                        <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
                                        {tFallback(t, 'agenda.lockedSteps', 'Later steps unlock in order')}
                                    </p>
                                )}
                                {lockedTasks.map((task) => (
                                    <div key={task.id} data-testid="focus-project-locked-task" className="opacity-70">
                                        {renderRow(task)}
                                    </div>
                                ))}
                            </div>
                        </Collapse>
                    )}
                </div>
            </div>
        </ReorderableTaskRow>
    );
}

/** Keeps the card's height steady: this row grows while the ticked row above collapses. */
function RisingRow({ children }: { children: ReactNode }) {
    const ref = useRef<HTMLDivElement | null>(null);
    useLayoutEffect(() => {
        const element = ref.current;
        if (!element || !canAnimate()) return;
        const height = element.getBoundingClientRect().height;
        if (height <= 0) return;
        element.style.overflow = 'hidden';
        const animation = element.animate(
            [{ height: '0px', opacity: 0 }, { height: `${height}px`, opacity: 1 }],
            { duration: COMPLETION_LEAVE_MS, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
        );
        const clear = () => { element.style.overflow = ''; };
        animation.addEventListener?.('finish', clear);
        return () => {
            animation.cancel();
            clear();
        };
    }, []);
    // The flex gap above this row is taken up by the row that is leaving.
    return <div ref={ref} className="-mt-2.5">{children}</div>;
}

function ProjectCardMenu({
    project,
    onNextActionOnlyChange,
    onOpenProject,
    onOrderProject,
    t,
}: {
    project: Project;
    onNextActionOnlyChange: (project: Project, enabled: boolean) => void;
    onOpenProject: (projectId: string) => void;
    onOrderProject?: (project: Project) => void;
    t: (key: string) => string;
}) {
    const buttonRef = useRef<HTMLButtonElement | null>(null);
    const panelRef = useRef<HTMLDivElement | null>(null);
    const [open, setOpen] = useState(false);
    const [style, setStyle] = useState<CSSProperties>({ position: 'fixed', top: 0, left: 0 });
    const nextActionOnly = project.isSequential === true;
    const label = `${tFallback(t, 'taskEdit.moreOptions', 'More options')}: ${project.title}`;

    useLayoutEffect(() => {
        if (!open) return;
        const place = () => {
            const rect = buttonRef.current?.getBoundingClientRect();
            if (!rect) return;
            const width = 208;
            setStyle({
                position: 'fixed',
                top: rect.bottom + 4,
                left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
            });
        };
        place();
        window.addEventListener('resize', place);
        window.addEventListener('scroll', place, true);
        return () => {
            window.removeEventListener('resize', place);
            window.removeEventListener('scroll', place, true);
        };
    }, [open]);

    useEffect(() => {
        if (!open) return;
        panelRef.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
        const onPointer = (event: Event) => {
            const target = event.target as Node;
            if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
            setOpen(false);
        };
        const onKey = (event: globalThis.KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            setOpen(false);
            buttonRef.current?.focus();
        };
        window.addEventListener('mousedown', onPointer);
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('mousedown', onPointer);
            window.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const menu = open && typeof document !== 'undefined' ? createPortal(
        <div
            ref={panelRef}
            role="menu"
            aria-label={label}
            style={style}
            className="motion-popover z-50 w-52 rounded-control bg-popover p-1 shadow-soft"
            onKeyDown={(event) => {
                if (event.key !== 'Tab') return;
                setOpen(false);
                buttonRef.current?.focus();
            }}
        >
            <ExitGhost />
            {onOrderProject && (
                <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                        setOpen(false);
                        onOrderProject(project);
                    }}
                    className="flex w-full items-center gap-2 rounded-control px-3 py-2 text-left text-sm transition-colors hover:bg-muted focus:bg-muted focus-ring"
                >
                    <Sparkles className="h-4 w-4 shrink-0 text-accent-text" aria-hidden="true" />
                    {tFallback(t, 'aiOrganise.orderProject', 'Order this project')}
                </button>
            )}
            <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={nextActionOnly}
                title={tFallback(t, 'projects.nextActionOnlyHint', "Only this project's next step shows in Focus; later steps wait their turn.")}
                onClick={() => {
                    setOpen(false);
                    onNextActionOnlyChange(project, !nextActionOnly);
                }}
                className="flex w-full items-center justify-between gap-2 rounded-control px-3 py-2 text-left text-sm transition-colors hover:bg-muted focus:bg-muted focus-ring"
            >
                <span>{tFallback(t, 'projects.nextActionOnly', 'Next action only')}</span>
                {nextActionOnly && <Check className="h-4 w-4 shrink-0 text-accent-text" aria-hidden="true" />}
            </button>
            <button
                type="button"
                role="menuitem"
                onClick={() => {
                    setOpen(false);
                    onOpenProject(project.id);
                }}
                className="flex w-full items-center gap-2 rounded-control px-3 py-2 text-left text-sm transition-colors hover:bg-muted focus:bg-muted focus-ring"
            >
                {tFallback(t, 'agenda.openProject', 'Open project')}
            </button>
        </div>,
        document.body,
    ) : null;

    return (
        <>
            <button
                ref={buttonRef}
                type="button"
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label={label}
                title={tFallback(t, 'taskEdit.moreOptions', 'More options')}
                onClick={() => setOpen((value) => !value)}
                className={cn(
                    'focus-ring inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-control text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground',
                )}
            >
                <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </button>
            {menu}
        </>
    );
}
