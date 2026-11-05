import type { ReactNode } from 'react';
import { Button } from '../../ui/Button';

type EmptyState = {
    title: string;
    body: string;
    action?: string;
};

type ListEmptyStateProps = {
    hasFilters: boolean;
    emptyState: EmptyState;
    onAddTask: () => void;
    primaryAction?: ReactNode;
    t: (key: string) => string;
};

export function ListEmptyState({ hasFilters, emptyState, onAddTask, primaryAction, t }: ListEmptyStateProps) {
    return (
        <div className="my-4 flex w-full max-w-2xl flex-col items-start gap-1.5 rounded-card bg-well px-6 py-7 text-left text-muted-foreground shadow-soft-inset">
            {hasFilters ? (
                <p className="text-sm">{t('filters.noMatch')}</p>
            ) : (
                <>
                    <div className="text-[15px] font-semibold text-foreground">{emptyState.title}</div>
                    <p className="max-w-md text-sm leading-6 text-muted-foreground">{emptyState.body}</p>
                    {(primaryAction || emptyState.action) && (
                        <div className="mt-3 flex flex-wrap items-center gap-2.5">
                            {primaryAction}
                            {emptyState.action && (
                                <Button
                                    size={primaryAction ? 'md' : 'lg'}
                                    variant={primaryAction ? 'ghost' : 'primary'}
                                    data-add-task-trigger
                                    onClick={onAddTask}
                                >
                                    {emptyState.action}
                                </Button>
                            )}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
