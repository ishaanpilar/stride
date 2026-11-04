import { CheckSquare, List } from 'lucide-react';
import { tFallback, type TaskSortBy } from '@stride/core';
import { Button } from '../../ui/Button';
import { ViewHeader } from '../../ui/ViewHeader';
import { CONTEXTS_AXES, type ContextsGroupBy } from '../list/next-grouping';
import { GroupBySelect } from '../list/GroupBySelect';
import {
    SortBySelect,
    ToolbarButton,
} from '../list/list-toolbar';

type ReviewHeaderProps = {
    title: string;
    taskCountLabel: string;
    onShowDailyGuide: () => void;
    onShowGuide: () => void;
    labels: {
        dailyReview: string;
        weeklyReview: string;
    };
};


export function ReviewHeader({
    title,
    taskCountLabel,
    onShowDailyGuide,
    onShowGuide,
    labels,
}: ReviewHeaderProps) {
    return (
        <ViewHeader
            title={title}
            count={taskCountLabel}
            actions={
                <>
                    <Button type="button" variant="secondary" onClick={onShowDailyGuide}>
                        {labels.dailyReview}
                    </Button>
                    <Button type="button" variant="primary" onClick={onShowGuide}>
                        {labels.weeklyReview}
                    </Button>
                </>
            }
        />
    );
}

type ReviewListControlsProps = {
    selectionMode: boolean;
    onToggleSelection: () => void;
    sortBy: TaskSortBy;
    onChangeSortBy: (value: TaskSortBy) => void;
    groupBy: ContextsGroupBy;
    onChangeGroupBy: (value: ContextsGroupBy) => void;
    showListDetails: boolean;
    onToggleDetails: () => void;
    disableStatusGrouping: boolean;
    t: (key: string) => string;
    labels: {
        select: string;
        exitSelect: string;
    };
};

export function ReviewListControls({
    selectionMode,
    onToggleSelection,
    sortBy,
    onChangeSortBy,
    groupBy,
    onChangeGroupBy,
    showListDetails,
    onToggleDetails,
    disableStatusGrouping,
    t,
    labels,
}: ReviewListControlsProps) {
    const detailsLabel = showListDetails
        ? tFallback(t, 'list.hideDetails', 'Hide details')
        : tFallback(t, 'list.showDetails', 'Show details');

    return (
        <div className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2">
            <SortBySelect
                value={sortBy}
                defaultValue="default"
                onChange={onChangeSortBy}
                t={t}
                className="min-w-0 max-w-full"
            />
            <GroupBySelect
                value={groupBy}
                defaultValue="none"
                axes={CONTEXTS_AXES}
                disabledAxes={disableStatusGrouping ? ['status'] : []}
                onChange={onChangeGroupBy}
                t={t}
                className="min-w-0 max-w-full"
            />
            <ToolbarButton
                active={showListDetails}
                onClick={onToggleDetails}
                title={detailsLabel}
                icon={<List className="h-3.5 w-3.5" aria-hidden="true" />}
            >
                {detailsLabel}
            </ToolbarButton>
            <ToolbarButton
                active={selectionMode}
                data-task-selection-toggle
                onClick={onToggleSelection}
                aria-pressed={selectionMode}
                icon={<CheckSquare className="h-3.5 w-3.5" aria-hidden="true" />}
            >
                {selectionMode ? labels.exitSelect : labels.select}
            </ToolbarButton>
        </div>
    );
}
