import { formatBlockedTickPrompt, formatRepeatTickPrompt, getOpenBlockers, tFallback, useTaskStore } from '@stride/core';
import { useEffect, useRef } from 'react';

import { useLanguage } from '../../contexts/language-context';
import { answerRepeatTick, useRepeatTickPending, useRepeatTickQuestion } from '../../lib/repeating-completion';
import { cn } from '../../lib/utils';

/** The compact question a row shows before a tick that needs confirming (a waiting task, or a second tick on a series). */
export function RepeatTickConfirm({ taskId, className }: { taskId: string; className?: string }) {
    const pending = useRepeatTickPending(taskId);
    return pending ? <RepeatTickConfirmPrompt taskId={taskId} className={className} /> : null;
}

function RepeatTickConfirmPrompt({ taskId, className }: { taskId: string; className?: string }) {
    const { t } = useLanguage();
    const cancelRef = useRef<HTMLButtonElement>(null);
    const task = useTaskStore((state) => state._tasksById.get(taskId));
    const lookup = useTaskStore((state) => state._tasksById);
    const blocked = useRepeatTickQuestion(taskId) === 'blocked' && task !== undefined;
    useEffect(() => {
        const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        // The safe answer has the focus, so a keyboard user who pressed the key twice can back out with it.
        cancelRef.current?.focus({ preventScroll: true });
        cancelRef.current?.scrollIntoView?.({ block: 'nearest' });
        return () => {
            if (previous?.isConnected) previous.focus({ preventScroll: true });
        };
    }, []);
    const prompt = blocked ? formatBlockedTickPrompt(getOpenBlockers(task, lookup), t) : formatRepeatTickPrompt(t, task ?? {});
    const buttonClass = 'rounded-control px-2 py-0.5 text-xs font-semibold focus-ring';
    return (
        <div
            role="group"
            aria-label={prompt}
            aria-live="polite"
            data-testid="repeat-tick-confirm"
            data-task-row-ignore-double-click
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Escape') answerRepeatTick(taskId, false);
            }}
            className={cn('flex flex-wrap items-center gap-2 rounded-control bg-well px-2.5 py-1.5 text-xs text-foreground', className)}
        >
            <span className="min-w-0 flex-1">{prompt}</span>
            <button type="button" onClick={() => answerRepeatTick(taskId, true)} className={cn(buttonClass, 'bg-accent-soft text-accent-text')}>
                {blocked ? tFallback(t, 'dependencies.doneAnyway', 'Done anyway') : tFallback(t, 'task.repeatTick.yes', 'Yes')}
            </button>
            <button ref={cancelRef} type="button" onClick={() => answerRepeatTick(taskId, false)} className={cn(buttonClass, 'text-muted-foreground hover:text-foreground')}>
                {tFallback(t, 'common.cancel', 'Cancel')}
            </button>
        </div>
    );
}
