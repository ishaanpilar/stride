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
        <div className="my-4 flex w-full max-w-xl flex-col items-start gap-2 px-1 py-5 text-left text-muted-foreground">
            {hasFilters ? (
                <p className="text-sm">{t('filters.noMatch')}</p>
            ) : (
                <>
                    <div className="text-base font-medium text-foreground">{emptyState.title}</div>
                    <p className="max-w-sm text-sm leading-6 text-muted-foreground">{emptyState.body}</p>
                    {primaryAction && (
                        <div className="mt-1 max-w-xs">{primaryAction}</div>
                    )}
                    {emptyState.action && (
                        <Button
                            size="xs"
                            variant={primaryAction ? 'ghost' : 'primary'}
                            data-add-task-trigger
                            onClick={onAddTask}
                        >
                            {emptyState.action}
                        </Button>
                    )}
                </>
            )}
        </div>
    );
}
