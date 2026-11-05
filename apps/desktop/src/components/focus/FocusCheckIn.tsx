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
import { OfferChip, focusActionLabel, formatFocusWhen } from './FocusCoachCard';
import type { FocusSummary } from './FocusFinish';

type Stage = 'ask' | 'done' | 'almost' | 'left' | 'blocked' | 'waiting' | 'needInfo' | 'notNow';

interface FocusCheckInProps {
    task: Task;
    project?: Project;
    summary: FocusSummary;
    sentence: string;
    focusMinutes: number;
    tr: (key: string, fallback: string) => string;
    onDone: () => Promise<FocusUndo | null>;
    onApply: (action: FocusCoachAction) => Promise<FocusUndo | null>;
    onAskCoach: (text: string) => Promise<FocusCoachReply>;
    onStartAnother: () => void;
    onTakeBreak: (afterDone: boolean) => void;
    onClose: () => void;
}

const primaryClass = 'btn-gradient inline-flex h-10 items-center justify-center gap-2 px-5 text-[14px] focus-ring';
const secondaryClass = 'inline-flex h-10 items-center justify-center gap-2 rounded-control border border-border bg-card px-4 text-[14px] font-medium text-foreground shadow-soft-sm transition-colors hover:bg-accent focus-ring';

export function FocusCheckIn(props: FocusCheckInProps) {
    const { task, project, summary, tr } = props;
    const [stage, setStage] = useState<Stage>('ask');
    const [doneUndo, setDoneUndo] = useState<FocusUndo | null>(null);
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

    const markDone = async () => {
        setBusy(true);
        const undo = await props.onDone();
        setBusy(false);
        if (!undo) return;
        setDoneUndo(undo);
        setStage('done');
    };
    const undoDone = async () => {
        if (doneUndo && await doneUndo.undo()) {
            setDoneUndo(null);
            setStage('ask');
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
                <p className="fx-done-line mx-auto mt-3 w-fit" role="status">
                    <Check className="h-3.5 w-3.5 text-success-text" aria-hidden />
                    {tr('focus.checkin.markedDone', 'Marked done')}
                    <button type="button" className="fx-link focus-ring" onClick={() => { void undoDone(); }}>{tr('common.undo', 'Undo')}</button>
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
                    <button type="button" data-autofocus disabled={busy} className="fx-chip fx-chip--lg fx-chip--accent focus-ring" onClick={() => { void markDone(); }}>
                        <Check className="h-4 w-4" aria-hidden />{tr('focus.checkin.done', 'Done')}
                    </button>
                    <button type="button" className="fx-chip fx-chip--lg focus-ring" onClick={() => setStage('almost')}>{tr('focus.checkin.almost', 'Almost')}</button>
                    <button type="button" className="fx-chip fx-chip--lg focus-ring" onClick={() => setStage('blocked')}>{tr('focus.checkin.notYet', 'Not yet')}</button>
                </div>
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
