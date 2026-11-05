import { Check, Coffee } from 'lucide-react';
import type { Project, Task } from '@stride/core';

export type FinishKind = 'session' | 'task';

export interface FocusSummary {
    minutes: number;
    stepsDone: number;
    stepsTotal: number;
    sessionsToday: number;
    streak: number;
}

interface FocusFinishProps {
    kind: FinishKind;
    task?: Task;
    project?: Project;
    sentence: string;
    summary: FocusSummary;
    tr: (key: string, fallback: string) => string;
    onMarkDone: () => void;
    onTakeBreak: () => void;
    onKeepGoing: () => void;
}

const secondaryClass = 'inline-flex h-10 items-center justify-center gap-2 rounded-control border border-border bg-card px-4 text-[14px] font-medium text-foreground shadow-soft-sm transition-colors hover:bg-accent focus-ring';
const primaryClass = 'btn-gradient inline-flex h-10 items-center justify-center gap-2 px-5 text-[14px] focus-ring';

/**
 * The finish: a drawn check, one heading, one sentence, three readable stats and a clear button
 * order. Everything sits on a solid card surface, so contrast never depends on the ambient light.
 */
export function FocusFinish({ kind, task, project, sentence, summary, tr, onMarkDone, onTakeBreak, onKeepGoing }: FocusFinishProps) {
    const allStepsDone = summary.stepsTotal > 0 && summary.stepsDone >= summary.stepsTotal;
    const heading = kind === 'task' || allStepsDone
        ? tr('focus.allStepsDone', 'Every step is done')
        : tr('focus.sessionDone', 'Session complete');
    const markDone = tr('pomodoro.markTaskDone', 'Mark task done');
    const takeBreak = tr('focus.takeBreak', 'Take a break');
    const keepGoing = tr('focus.keepGoing', 'Keep going');

    const stats: Array<[string, string]> = [[tr('focus.minutesFocused', 'Minutes focused'), String(summary.minutes)]];
    if (summary.stepsTotal > 0) stats.push([tr('focus.stepsDone', 'Steps done'), `${summary.stepsDone}/${summary.stepsTotal}`]);
    if (summary.sessionsToday > 0) stats.push([tr('focus.sessionsToday', 'Sessions today'), String(summary.sessionsToday)]);
    if (summary.streak > 1) stats.push([tr('focus.streak', 'Day streak'), String(summary.streak)]);

    return (
        <section className="fx-finish" data-testid="focus-summary" data-kind={kind} aria-labelledby="fx-finish-heading">
            <div className="fx-mark-wrap" aria-hidden>
                <span className="fx-mark-bloom" />
                <svg className="fx-mark" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="45" />
                    <path d="M31 52l12 12 26-28" />
                </svg>
            </div>
            {task && (
                <p className="flex items-center justify-center gap-2 text-[14px] text-muted-foreground">
                    {project?.color && <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: project.color }} aria-hidden />}
                    <span className="truncate">{task.title}</span>
                </p>
            )}
            <h2 id="fx-finish-heading" className="mt-1.5">{heading}</h2>
            {sentence && <p className="fx-finish-line">{sentence}</p>}
            <dl className="fx-stats" style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }}>
                {stats.map(([label, value]) => (
                    <div key={label} className="flex flex-col-reverse items-center gap-0.5 px-1">
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                    </div>
                ))}
            </dl>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
                {!task ? (
                    <>
                        <button type="button" data-autofocus onClick={onTakeBreak} className={primaryClass}>
                            <Coffee className="h-4 w-4" aria-hidden />{takeBreak}
                        </button>
                        <button type="button" onClick={onKeepGoing} className={secondaryClass}>{keepGoing}</button>
                    </>
                ) : allStepsDone ? (
                    <>
                        <button type="button" data-autofocus onClick={onMarkDone} className={primaryClass}>
                            <Check className="h-4 w-4" aria-hidden />{markDone}
                        </button>
                        <button type="button" onClick={onTakeBreak} className={secondaryClass}>
                            <Coffee className="h-4 w-4" aria-hidden />{takeBreak}
                        </button>
                        <button type="button" onClick={onKeepGoing} className="fx-text-btn focus-ring">{keepGoing}</button>
                    </>
                ) : (
                    <>
                        <button type="button" data-autofocus onClick={onTakeBreak} className={primaryClass}>
                            <Coffee className="h-4 w-4" aria-hidden />{takeBreak}
                        </button>
                        <button type="button" onClick={onKeepGoing} className={secondaryClass}>{keepGoing}</button>
                        <button type="button" onClick={onMarkDone} className="fx-text-btn focus-ring">{markDone}</button>
                    </>
                )}
            </div>
        </section>
    );
}
