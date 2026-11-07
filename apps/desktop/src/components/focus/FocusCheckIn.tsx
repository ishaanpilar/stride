import { useState, type KeyboardEvent } from 'react';
import {
    formatFocusCoachMinutes,
    suggestFocusRescheduleSlot,
    type FocusCoachAction,
    type FocusCoachReply,
    type Project,
    type Task,
} from '@stride/core';
import { ArrowLeft, Check, Coffee, Play } from 'lucide-react';
import { isImeComposing } from '../../lib/ime';
import type { FocusUndo } from '../../lib/focus-coach-store';
import { guardRepeatTick, stopRepeatingOccurrence, type RepeatingCompletion } from '../../lib/repeating-completion';
import { reportError } from '../../lib/report-error';
import { RepeatTickConfirm } from '../Task/RepeatTickConfirm';
import { OfferChip, focusActionLabel, formatFocusWhen } from './FocusCoachCard';
import type { FocusSummary } from './FocusFinish';

/** "Done" went through. A repeating task also says when it comes back. */
export interface FocusDone extends FocusUndo {
    repeating?: RepeatingCompletion | null;
}

type Stage = 'ask' | 'done' | 'almost' | 'plan' | 'left' | 'blocked' | 'waiting' | 'needInfo' | 'notNow';

interface FocusCheckInProps {
    task: Task;
    project?: Project;
    summary: FocusSummary;
    sentence: string;
    focusMinutes: number;
    tr: (key: string, fallback: string) => string;
    onDone: () => Promise<FocusDone | null>;
    describeRepeating: () => RepeatingCompletion | null;
    onApply: (action: FocusCoachAction) => Promise<FocusUndo | null>;
    onAskCoach: (text: string) => Promise<FocusCoachReply>;
    onStartAnother: () => void;
    onTakeBreak: (afterDone: boolean) => void;
    onClose: () => void;
    /** "Almost" → how much is left: extend this same session by that many minutes and keep going. */
    onExtend: (minutes: number) => void;
}

const primaryClass = 'btn-gradient inline-flex h-10 items-center justify-center gap-2 px-5 text-[14px] focus-ring';
const secondaryClass = 'inline-flex h-10 items-center justify-center gap-2 rounded-control border border-border bg-card px-4 text-[14px] font-medium text-foreground shadow-soft-sm transition-colors hover:bg-accent focus-ring';

export function FocusCheckIn(props: FocusCheckInProps) {
    const { task, project, summary, tr } = props;
    // Ticked done during the session (e.g. in overtime): the check-in opens on "Done".
    const [stage, setStage] = useState<Stage>(task.status === 'done' ? 'done' : 'ask');
    const [doneUndo, setDoneUndo] = useState<FocusUndo | null>(null);
    const [repeating, setRepeating] = useState<RepeatingCompletion | null>(() => (task.status === 'done' ? props.describeRepeating() : null));
    /** Set after "Stop repeating": puts the next occurrence back. */
    const [stopped, setStopped] = useState<(() => Promise<void>) | null>(null);
    const [left, setLeft] = useState<number | null>(null);
    const [busy, setBusy] = useState(false);
    const [person, setPerson] = useState(task.assignedTo ?? '');
    const [reason, setReason] = useState('');
    const [coachReply, setCoachReply] = useState<FocusCoachReply | 'loading' | null>(null);
    const slot = suggestFocusRescheduleSlot(new Date());
    const when = formatFocusWhen(slot.date, slot.time, tr);
    const schedule: FocusCoachAction = { type: 'schedule', date: slot.date, time: slot.time };

    const stats = [tr('focus.checkin.minutes', '{{count}} min focused').replace('{{count}}', String(summary.minutes))];
    if (summary.sessionsToday > 0) stats.push(tr('focus.checkin.sessions', '{{count}} sessions today').replace('{{count}}', String(summary.sessionsToday)));

    const completeTask = async () => {
        setBusy(true);
        const done = await props.onDone();
        setBusy(false);
        if (!done) return;
        setDoneUndo(done);
        setRepeating(done.repeating ?? null);
        setStage('done');
    };
    // The app's toasts sit under the stage, so the question and the result are both shown here.
    const markDone = () => guardRepeatTick(task.id, () => { void completeTask(); });
    const undoDone = async () => {
        if (doneUndo && await doneUndo.undo()) {
            setDoneUndo(null);
            setRepeating(null);
            setStage('ask');
        }
    };
    const stopRepeating = async () => {
        if (!repeating) return;
        try {
            const restore = await stopRepeatingOccurrence(repeating.occurrenceId);
            setStopped(() => restore);
        } catch (error) {
            reportError('Failed to stop repeating', error);
        }
    };
    const undoStop = async () => {
        if (!stopped) return;
        try {
            await stopped();
            setStopped(null);
        } catch (error) {
            reportError('Failed to undo stop repeating', error);
        }
    };
    const askCoach = async () => {
        const text = reason.trim();
        if (!text) return;
        setCoachReply('loading');
        setCoachReply(await props.onAskCoach(text));
    };
    const onReasonKey = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter' && !isImeComposing(event)) { event.preventDefault(); void askCoach(); }
    };

    const back = (
        <button type="button" className="fx-link fx-link--muted inline-flex items-center gap-1 focus-ring" onClick={() => { setStage('ask'); setCoachReply(null); }}>
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />{tr('common.back', 'Back')}
        </button>
    );
    const leftOptions: Array<[string, number]> = [
        [tr('focus.checkin.left10', '~10 min'), 10],
        [tr('focus.checkin.left25', '~25 min'), 25],
        [tr('focus.checkin.left60', '~1 h'), 60],
        [tr('focus.checkin.leftSession', 'Another session'), props.focusMinutes],
    ];
    /** The last option is a fresh focus phase on the same task; the others extend this session. */
    const keepGoingFor = (index: number, minutes: number) => {
        if (index === leftOptions.length - 1) props.onStartAnother();
        else props.onExtend(minutes);
    };

    let body;
    if (stage === 'done') {
        body = (
            <>
                <div className="fx-mark-wrap" aria-hidden>
                    <span className="fx-mark-bloom" />
                    <svg className="fx-mark" viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" /><path d="M31 52l12 12 26-28" /></svg>
                </div>
                <h2 id="fx-finish-heading">{tr('focus.checkin.doneTitle', 'Done. Nicely handled.')}</h2>
                <p className="fx-finish-line">{props.sentence}</p>
                <p className="fx-done-line mx-auto mt-3 w-fit flex-wrap justify-center" role="status" data-testid="focus-checkin-done-line">
                    <Check className="h-3.5 w-3.5 text-success-text" aria-hidden />
                    {stopped ? tr('task.repeatStopped', 'Stopped repeating') : repeating?.message ?? tr('focus.checkin.markedDone', 'Marked done')}
                    {stopped
                        ? <button type="button" className="fx-link focus-ring" onClick={() => { void undoStop(); }}>{tr('common.undo', 'Undo')}</button>
                        : doneUndo && <button type="button" className="fx-link focus-ring" onClick={() => { void undoDone(); }}>{tr('common.undo', 'Undo')}</button>}
                    {repeating && !stopped && (
                        <button type="button" className="fx-link fx-link--muted focus-ring" onClick={() => { void stopRepeating(); }}>{tr('task.stopRepeating', 'Stop repeating')}</button>
                    )}
                </p>
                <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
                    <button type="button" data-autofocus onClick={() => props.onTakeBreak(true)} className={primaryClass}>
                        <Coffee className="h-4 w-4" aria-hidden />{tr('focus.takeBreak', 'Take a break')}
                    </button>
                    <button type="button" onClick={props.onClose} className={secondaryClass}>{tr('common.close', 'Close')}</button>
                </div>
            </>
        );
    } else if (stage === 'almost') {
        // Primary: keep going on this same session for about that long (back to the running stage).
        body = (
            <>
                <h2 id="fx-finish-heading">{tr('focus.checkin.howMuchLeft', 'How much is left?')}</h2>
                <p className="fx-finish-line">{tr('focus.checkin.keepGoingHint', 'Pick one and keep going on this task.')}</p>
                <div className="fx-chips fx-chips--center mt-4" role="group" aria-label={tr('focus.checkin.howMuchLeft', 'How much is left?')}>
                    {leftOptions.map(([label, minutes], index) => (
                        <button
                            key={label}
                            type="button"
                            data-autofocus={index === 0 ? true : undefined}
                            className="fx-chip fx-chip--lg focus-ring"
                            data-testid={`focus-checkin-keep-${index === leftOptions.length - 1 ? 'session' : minutes}`}
                            onClick={() => keepGoingFor(index, minutes)}
                        >
                            {label}
                        </button>
                    ))}
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
                    <button type="button" className="fx-text-btn focus-ring" onClick={() => setStage('plan')} data-testid="focus-checkin-plan">
                        {tr('focus.checkin.planInstead', 'Plan the rest instead')}
                    </button>
                </div>
                <div className="mt-1">{back}</div>
            </>
        );
    } else if (stage === 'plan') {
        // Secondary: set an estimate or schedule the rest, without continuing now.
        body = (
            <>
                <h2 id="fx-finish-heading">{tr('focus.checkin.howMuchLeft', 'How much is left?')}</h2>
                <div className="fx-chips fx-chips--center mt-4" role="group" aria-label={tr('focus.checkin.howMuchLeft', 'How much is left?')}>
                    {leftOptions.map(([label, minutes]) => (
                        <button key={label} type="button" className="fx-chip focus-ring" onClick={() => { setLeft(minutes); setStage('left'); }}>{label}</button>
                    ))}
                </div>
                <div className="mt-4">{back}</div>
            </>
        );
    } else if (stage === 'left' && left !== null) {
        body = (
            <>
                <h2 id="fx-finish-heading">{tr('focus.checkin.leftTitle', 'About {{time}} to go').replace('{{time}}', formatFocusCoachMinutes(left, tr))}</h2>
                <div className="fx-chips fx-chips--center mt-3">
                    <OfferChip
                        label={tr('focus.coach.action.estimate', 'Set estimate to {{time}}').replace('{{time}}', formatFocusCoachMinutes(left, tr))}
                        tr={tr}
                        testId="focus-checkin-estimate"
                        onApply={() => props.onApply({ type: 'set_time_estimate', minutes: left })}
                    />
                    <OfferChip
                        label={tr('focus.checkin.scheduleRest', 'Schedule the rest for {{when}}').replace('{{when}}', when)}
                        tr={tr}
                        testId="focus-checkin-schedule"
                        onApply={() => props.onApply(schedule)}
                    />
                </div>
                <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
                    <button type="button" data-autofocus onClick={props.onStartAnother} className={primaryClass}>
                        <Play className="h-4 w-4" aria-hidden />{tr('focus.checkin.startAnother', 'Start another session')}
                    </button>
                    <button type="button" onClick={() => props.onTakeBreak(false)} className={secondaryClass}>
                        <Coffee className="h-4 w-4" aria-hidden />{tr('focus.takeBreak', 'Take a break')}
                    </button>
                </div>
                <div className="mt-3">{back}</div>
            </>
        );
    } else if (stage === 'blocked') {
        body = (
            <>
                <h2 id="fx-finish-heading">{tr('focus.checkin.blocking', "What's in the way?")}</h2>
                <div className="fx-chips fx-chips--center mt-4" role="group" aria-label={tr('focus.checkin.blocking', "What's in the way?")}>
                    <button type="button" className="fx-chip focus-ring" onClick={() => setStage('waiting')}>{tr('focus.checkin.waitingOn', 'Waiting on someone')}</button>
                    <button type="button" className="fx-chip focus-ring" onClick={() => setStage('needInfo')}>{tr('focus.checkin.needInfo', 'Need info')}</button>
                    <button type="button" className="fx-chip focus-ring" onClick={() => setStage('notNow')}>{tr('focus.checkin.notNow', 'Not now')}</button>
                </div>
                <div className="fx-reply mx-auto mt-3 max-w-sm">
                    <input
                        value={reason}
                        maxLength={160}
                        onChange={(e) => setReason(e.target.value)}
                        onKeyDown={onReasonKey}
                        placeholder={tr('focus.checkin.typeReason', "Or say what's blocking")}
                        aria-label={tr('focus.checkin.typeReason', "Or say what's blocking")}
                        className="fx-reply-input focus-ring"
                    />
                </div>
                {coachReply === 'loading' && <p className="fx-loading fx-loading--sm justify-center" role="status"><span className="fx-shimmer-text">{tr('focus.coach.thinkingShort', 'Thinking…')}</span></p>}
                {coachReply && coachReply !== 'loading' && (
                    <div className="mt-3" data-testid="focus-checkin-reply">
                        <p className="fx-finish-line">{coachReply.reply}</p>
                        <div className="fx-chips fx-chips--center mt-2">
                            {coachReply.timerMinutes && coachReply.timerMinutes <= 60 && (
                                // The coach thinks it needs a bit longer: keep going on this same session.
                                <button
                                    type="button"
                                    className="fx-chip fx-chip--accent focus-ring"
                                    data-testid="focus-checkin-keep-coach"
                                    onClick={() => props.onExtend(coachReply.timerMinutes!)}
                                >
                                    {tr('focus.checkin.keepGoingFor', 'Keep going for {{time}}').replace('{{time}}', formatFocusCoachMinutes(coachReply.timerMinutes, tr))}
                                </button>
                            )}
                            {coachReply.actions.map((action, index) => (
                                <OfferChip key={`${action.type}-${index}`} label={focusActionLabel(action, tr)} tr={tr} onApply={() => props.onApply(action)} />
                            ))}
                        </div>
                    </div>
                )}
                <div className="mt-4">{back}</div>
            </>
        );
    } else if (stage === 'waiting') {
        body = (
            <>
                <h2 id="fx-finish-heading">{tr('focus.checkin.who', 'Who are you waiting on?')}</h2>
                <div className="fx-reply mx-auto mt-4 max-w-xs">
                    <input
                        value={person}
                        maxLength={40}
                        onChange={(e) => setPerson(e.target.value)}
                        placeholder={tr('taskEdit.assignedToPlaceholder', 'Who is this waiting for?')}
                        aria-label={tr('focus.checkin.who', 'Who are you waiting on?')}
                        className="fx-reply-input focus-ring"
                    />
                </div>
                <div className="fx-chips fx-chips--center mt-3">
                    <OfferChip
                        primary
                        label={tr('focus.coach.action.waiting', 'Move to Waiting For')}
                        tr={tr}
                        testId="focus-checkin-waiting"
                        onApply={() => props.onApply(person.trim() ? { type: 'set_waiting_for', person: person.trim().slice(0, 40) } : { type: 'set_waiting_for' })}
                    />
                </div>
                <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
                    <button type="button" onClick={props.onClose} className={secondaryClass}>{tr('common.close', 'Close')}</button>
                </div>
                <div className="mt-3">{back}</div>
            </>
        );
    } else if (stage === 'needInfo' || stage === 'notNow') {
        const followup = tr('focus.checkin.followupTitle', 'Get info for: {{title}}').replace('{{title}}', task.title).slice(0, 120);
        body = (
            <>
                <h2 id="fx-finish-heading">
                    {stage === 'needInfo' ? tr('focus.checkin.needInfoTitle', 'Park it until you have the info') : tr('focus.checkin.notNowTitle', 'Fine. Pick it up later.')}
                </h2>
                <div className="fx-chips fx-chips--center mt-4">
                    {stage === 'needInfo' && (
                        <OfferChip label={tr('focus.coach.action.followup', 'Add task: {{title}}').replace('{{title}}', followup)} tr={tr} testId="focus-checkin-followup" onApply={() => props.onApply({ type: 'add_followup_task', title: followup })} />
                    )}
                    <OfferChip label={tr('focus.checkin.reschedule', 'Reschedule to {{when}}').replace('{{when}}', when)} tr={tr} testId="focus-checkin-reschedule" onApply={() => props.onApply(schedule)} />
                </div>
                <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
                    <button type="button" data-autofocus onClick={() => props.onTakeBreak(false)} className={primaryClass}>
                        <Coffee className="h-4 w-4" aria-hidden />{tr('focus.takeBreak', 'Take a break')}
                    </button>
                    <button type="button" onClick={props.onClose} className={secondaryClass}>{tr('common.close', 'Close')}</button>
                </div>
                <div className="mt-3">{back}</div>
            </>
        );
    } else {
        body = (
            <>
                <h2 id="fx-finish-heading">{tr('focus.checkin.title', 'Is it done?')}</h2>
                <div className="fx-chips fx-chips--center mt-4" role="group" aria-label={tr('focus.checkin.title', 'Is it done?')}>
                    <button type="button" data-autofocus disabled={busy} className="fx-chip fx-chip--lg fx-chip--accent focus-ring" onClick={markDone}>
                        <Check className="h-4 w-4" aria-hidden />{tr('focus.checkin.done', 'Done')}
                    </button>
                    <button type="button" className="fx-chip fx-chip--lg focus-ring" onClick={() => setStage('almost')}>{tr('focus.checkin.almost', 'Almost')}</button>
                    <button type="button" className="fx-chip fx-chip--lg focus-ring" onClick={() => setStage('blocked')}>{tr('focus.checkin.notYet', 'Not yet')}</button>
                </div>
                <RepeatTickConfirm taskId={task.id} className="mx-auto mt-3 max-w-sm" />
            </>
        );
    }

    return (
        <section className="fx-finish" data-testid="focus-checkin" data-stage={stage} aria-labelledby="fx-finish-heading">
            <p className="mb-2 flex items-center justify-center gap-2 text-[14px] text-muted-foreground">
                {project?.color && <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: project.color }} aria-hidden />}
                <span className="truncate">{task.title}</span>
            </p>
            {body}
            <p className="fx-checkin-stats" data-testid="focus-checkin-stats">{stats.join(' · ')}</p>
        </section>
    );
}
