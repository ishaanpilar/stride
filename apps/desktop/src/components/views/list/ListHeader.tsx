import { useEffect, useRef, useState } from 'react';
import { CheckSquare, Filter, List, MoreHorizontal, Plus, SlidersHorizontal } from 'lucide-react';
import { tFallback, type TaskSortBy } from '@stride/core';
import { FOCUS_AXES, type TaskListGroupBy } from './next-grouping';
import { cn } from '../../../lib/utils';
import { IconButton } from '../../ui/IconButton';
import { Pill } from '../../ui/Pill';
import { ViewHeader, type ViewHeaderProgress } from '../../ui/ViewHeader';
import { ViewControls } from './ViewControls';
import { ViewHeaderActions } from './ViewHeaderActions';
import { ExitGhost } from '../../ui/ExitGhost';

type ListHeaderProps = {
    title: string;
    showNextCount: boolean;
    nextCount: number;
    taskCount: number;
    scopeLabel?: string;
    hasFilters: boolean;
    filterSummaryLabel: string;
    filterSummarySuffix: string;
    sortBy: TaskSortBy;
    defaultSortBy?: TaskSortBy;
    sortByOptions?: readonly TaskSortBy[];
    onChangeSortBy: (value: TaskSortBy) => void;
    manualSort?: { label: string; selected: boolean; onSelect: () => void };
    showGroupBy?: boolean;
    groupBy?: TaskListGroupBy;
    defaultGroupBy?: TaskListGroupBy;
    groupByOptions?: readonly TaskListGroupBy[];
    onChangeGroupBy?: (value: TaskListGroupBy) => void;
    showFiltersButton?: boolean;
    filtersOpen?: boolean;
    onToggleFilters?: () => void;
    selectionMode: boolean;
    onToggleSelection: () => void;
    showDetailsToggle?: boolean;
    showListDetails: boolean;
    onToggleDetails: () => void;
    onNewSomedaySection?: () => void;
    /** Optional "Today: X of Y done" progress line and bar under the title. */
    progress?: ViewHeaderProgress;
    /** Controls only, no title row (the Inbox shows its own header and tucks these behind "…"). */
    controlsOnly?: boolean;
    t: (key: string) => string;
};

export function ListHeader({
    title,
    showNextCount,
    nextCount,
    taskCount,
    scopeLabel,
    hasFilters,
    filterSummaryLabel,
    filterSummarySuffix,
    sortBy,
    defaultSortBy = 'default',
    sortByOptions,
    onChangeSortBy,
    manualSort,
    showGroupBy = false,
    groupBy = 'none',
    defaultGroupBy = 'none',
    groupByOptions = FOCUS_AXES,
    onChangeGroupBy,
    showFiltersButton = false,
    filtersOpen = false,
    onToggleFilters,
    selectionMode,
    onToggleSelection,
    showDetailsToggle = true,
    showListDetails,
    onToggleDetails,
    onNewSomedaySection,
    progress,
    controlsOnly = false,
    t,
}: ListHeaderProps) {
    const [overflowOpen, setOverflowOpen] = useState(false);
    const overflowRef = useRef<HTMLDivElement | null>(null);
    const overflowTriggerRef = useRef<HTMLButtonElement | null>(null);
    const moreOptionsLabel = tFallback(t, 'taskEdit.moreOptions', 'More options');
    const detailsLabel = showListDetails
        ? tFallback(t, 'list.hideDetails', 'Hide details')
        : tFallback(t, 'list.showDetails', 'Show details');

    useEffect(() => {
        if (!overflowOpen) return;
        const handleMouseDown = (event: MouseEvent) => {
            if (!overflowRef.current?.contains(event.target as Node)) setOverflowOpen(false);
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            setOverflowOpen(false);
            overflowTriggerRef.current?.focus();
        };
        window.addEventListener('mousedown', handleMouseDown);
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('mousedown', handleMouseDown);
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [overflowOpen]);

    const controlActive = 'bg-primary/10 text-accent-text border-primary/40 hover:bg-primary/15';
    const controls = (
        <div className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2">
            {showFiltersButton && onToggleFilters && (
                <IconButton
                    aria-label={t('filters.label')}
                    title={t('filters.label')}
                    onClick={onToggleFilters}
                    aria-expanded={filtersOpen}
                    aria-controls="list-filters-panel"
                    className={cn(filtersOpen && controlActive)}
                >
                    <Filter className="h-4 w-4" aria-hidden="true" />
                </IconButton>
            )}
            <IconButton
                aria-label={selectionMode ? t('bulk.exitSelect') : t('bulk.select')}
                title={selectionMode ? t('bulk.exitSelect') : t('bulk.select')}
                onClick={onToggleSelection}
                aria-pressed={selectionMode}
                className={cn(selectionMode && controlActive)}
            >
                <CheckSquare className="h-4 w-4" aria-hidden="true" />
            </IconButton>
            <ViewControls
                sortBy={sortBy}
                defaultSortBy={defaultSortBy}
                sortByOptions={sortByOptions}
                onChangeSortBy={onChangeSortBy}
                manualSort={manualSort}
                groupBy={showGroupBy && onChangeGroupBy ? groupBy : undefined}
                defaultGroupBy={showGroupBy && onChangeGroupBy ? defaultGroupBy : undefined}
                groupByOptions={showGroupBy && onChangeGroupBy ? groupByOptions : undefined}
                onChangeGroupBy={onChangeGroupBy}
                t={t}
            />
            {showDetailsToggle && (
                <IconButton
                    aria-label={detailsLabel}
                    title={detailsLabel}
                    onClick={onToggleDetails}
                    className={cn(showListDetails && controlActive)}
                >
                    <List className="h-4 w-4" aria-hidden="true" />
                </IconButton>
            )}
            {onNewSomedaySection && (
                <div ref={overflowRef} className="relative">
                    <IconButton
                        ref={overflowTriggerRef}
                        aria-label={moreOptionsLabel}
                        aria-haspopup="menu"
                        aria-expanded={overflowOpen}
                        onClick={() => setOverflowOpen((open) => !open)}
                    >
                        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                    </IconButton>
                    {overflowOpen && (
                        <div role="menu" aria-label={moreOptionsLabel} className="motion-popover absolute right-0 top-full z-50 mt-2 w-48 rounded-control border border-border bg-popover p-1 text-popover-foreground shadow-soft [--motion-origin:top_right]">
                            <ExitGhost />
                            <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                    setOverflowOpen(false);
                                    onNewSomedaySection();
                                }}
                                className="focus-ring flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-accent focus:bg-accent"
                            >
                                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                                {tFallback(t, 'viewSections.add', 'New section…')}
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );

    if (controlsOnly) {
        return (
            <div className="motion-expand-in flex flex-wrap items-center justify-end gap-2" data-list-view-options>
                <ViewHeaderActions>{controls}</ViewHeaderActions>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-4">
            <ViewHeader
                title={showNextCount ? (
                    <>
                        {title}
                        <span className="ml-2 align-baseline text-lg font-medium text-muted-foreground">({nextCount})</span>
                    </>
                ) : title}
                count={(
                    <span className="inline-flex flex-wrap items-center gap-2" aria-live="polite">
                        <span>{taskCount} {t('common.tasks')}</span>
                        {scopeLabel && <Pill>{scopeLabel}</Pill>}
                        {hasFilters && (
                            <Pill tone="accent" icon={<SlidersHorizontal aria-hidden="true" />} className="sm:max-w-[420px]">
                                <span className="truncate">{filterSummaryLabel}{filterSummarySuffix}</span>
                            </Pill>
                        )}
                    </span>
                )}
                progress={progress}
                actions={<ViewHeaderActions>{controls}</ViewHeaderActions>}
            />
        </div>
    );
}
