import { useState, type KeyboardEvent, type ReactNode } from 'react';
import {
    formatFocusCoachMinutes,
    toFocusLocalDate,
    type FocusCoachAction,
    type FocusCoachFeedbackVerdict,
} from '@stride/core';
import { Check, ChevronDown, HelpCircle, Clock, ListPlus, Sparkles, ThumbsDown, ThumbsUp } from 'lucide-react';
import { cn } from '../../lib/utils';
import { isImeComposing } from '../../lib/ime';
import type { FocusUndo } from '../../lib/focus-coach-store';
import type { FocusCoachApi } from './useFocusCoach';

type Tr = (key: string, fallback: string) => string;

export function formatFocusWhen(date: string, time: string | undefined, tr: Tr, now = new Date()): string {
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    const day = date === toFocusLocalDate(now)
        ? tr('focus.when.today', 'today')
        : date === toFocusLocalDate(tomorrow)
            ? tr('focus.when.tomorrow', 'tomorrow')
            : new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    return time ? tr('focus.when.at', '{{day}} at {{time}}').replace('{{day}}', day).replace('{{time}}', time) : day;
}

export function focusActionLabel(action: FocusCoachAction, tr: Tr): string {
    switch (action.type) {
        case 'set_time_estimate':
            return tr('focus.coach.action.estimate', 'Set estimate to {{time}}').replace('{{time}}', formatFocusCoachMinutes(action.minutes, tr));
        case 'add_followup_task':
            return tr('focus.coach.action.followup', 'Add task: {{title}}').replace('{{title}}', action.title);
        case 'set_waiting_for':
            return action.person
                ? tr('focus.coach.action.waitingFor', 'Waiting for {{person}}').replace('{{person}}', action.person)
                : tr('focus.coach.action.waiting', 'Move to Waiting For');
        case 'schedule':
            return tr('focus.coach.action.schedule', 'Schedule for {{when}}').replace('{{when}}', formatFocusWhen(action.date, action.time, tr));
    }
}

export function OfferChip({ label, doneLabel, onApply, tr, primary = false, testId }: {
    label: string;
    /** What the line says once applied (defaults to the label). */
    doneLabel?: string;
    onApply: () => Promise<FocusUndo | null>;
    tr: Tr;
    primary?: boolean;
    testId?: string;
}) {
    const [state, setState] = useState<{ kind: 'idle' | 'busy' | 'failed' } | { kind: 'done'; undo: FocusUndo }>({ kind: 'idle' });
    if (state.kind === 'done') {
        return (
            <span className="fx-done-line" role="status" data-testid={testId ? `${testId}-done` : undefined}>
                <Check className="h-3.5 w-3.5 text-success-text" aria-hidden />
                <span className="min-w-0 truncate">{doneLabel ?? label}</span>
                <button
                    type="button"
                    className="fx-link focus-ring"
                    onClick={async () => { if (await state.undo.undo()) setState({ kind: 'idle' }); }}
                >
                    {tr('common.undo', 'Undo')}
                </button>
            </span>
        );
    }
    return (
        <button
            type="button"
            data-testid={testId}
            disabled={state.kind === 'busy'}
            onClick={async () => {
                setState({ kind: 'busy' });
                const undo = await onApply();
                setState(undo ? { kind: 'done', undo } : { kind: 'failed' });
            }}
            className={cn('fx-chip focus-ring', primary && 'fx-chip--accent')}
            title={state.kind === 'failed' ? tr('focus.coach.failed', 'Could not apply that.') : undefined}
        >
            {label}
        </button>
    );
}

function Feedback({ tr, value, onRate, compact = false, testId }: {
    tr: Tr;
    value?: FocusCoachFeedbackVerdict;
    onRate: (verdict: FocusCoachFeedbackVerdict) => void;
    compact?: boolean;
    testId: string;
}) {
    const useful = tr('focus.coach.useful', 'Useful');
    const notUseful = tr('focus.coach.notUseful', 'Not useful');
    const nonsense = tr('focus.coach.nonsense', "Doesn't make sense");
    return (
        <div className={cn('fx-feedback', compact && 'fx-feedback--compact')} role="group" aria-label={tr('focus.coach.feedback', 'Feedback')} data-testid={testId}>
            <button type="button" aria-label={useful} title={useful} aria-pressed={value === 'useful'} onClick={() => onRate('useful')} className="fx-icon-btn focus-ring">
                <ThumbsUp className="h-3.5 w-3.5" aria-hidden />
            </button>
            <button type="button" aria-label={notUseful} title={notUseful} onClick={() => onRate('not_useful')} className="fx-icon-btn focus-ring">
                <ThumbsDown className="h-3.5 w-3.5" aria-hidden />
            </button>
            {compact ? (
                <button type="button" aria-label={nonsense} title={nonsense} onClick={() => onRate('nonsense')} className="fx-icon-btn focus-ring">
                    <HelpCircle className="h-3.5 w-3.5" aria-hidden />
                </button>
            ) : (
                <button type="button" onClick={() => onRate('nonsense')} className="fx-link fx-link--muted focus-ring">{nonsense}</button>
            )}
        </div>
    );
}

function ReplyInput({ tr, onSend, placeholder, label }: { tr: Tr; onSend: (text: string) => void; placeholder: string; label: string }) {
    const [draft, setDraft] = useState('');
    const send = () => {
        if (!draft.trim()) return;
        onSend(draft);
        setDraft('');
    };
    const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter' && !isImeComposing(event)) { event.preventDefault(); send(); }
        if (event.key === 'Escape' && draft) { event.stopPropagation(); setDraft(''); }
    };
    return (
        <div className="fx-reply">
            <input
                value={draft}
                maxLength={160}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKey}
                placeholder={placeholder}
                aria-label={label}
                className="fx-reply-input focus-ring"
            />
            {draft.trim() && (
                <button type="button" onClick={send} className="fx-chip fx-chip--accent focus-ring">{tr('focus.coach.send', 'Send')}</button>
            )}
        </div>
    );
}

export interface FocusCoachTimer {
    /** The focus timer's current length in minutes. */
    minutes: number;
    /** "Set timer to N min": change the timer (and save N as the estimate); returns the Undo. */
    onSet: (minutes: number) => Promise<FocusUndo | null>;
}

const MAX_TIMER_MINUTES = 180;

/** "About 40 min · two cuts and an export", then "Set timer to 40 min" and a quiet "Keep 25". */
function EstimateOffer({ minutes, timer, tr }: { minutes: number; timer: FocusCoachTimer; tr: Tr }) {
    const [kept, setKept] = useState(false);
    const [applied, setApplied] = useState(false);
    if (kept || (!applied && (minutes === timer.minutes || minutes > MAX_TIMER_MINUTES))) return null;
    const time = formatFocusCoachMinutes(minutes, tr);
    return (
        <div className="fx-chips mt-2" role="group" aria-label={tr('focus.coach.timerOffer', 'Timer')} data-testid="focus-coach-timer-offer">
            <OfferChip
                primary
                label={tr('focus.coach.setTimer', 'Set timer to {{time}}').replace('{{time}}', time)}
                doneLabel={tr('focus.coach.timerSet', 'Timer set to {{time}}').replace('{{time}}', time)}
                tr={tr}
                testId="focus-coach-set-timer"
                onApply={async () => {
                    // Mark first: once the timer says N the offer would otherwise hide itself.
                    setApplied(true);
                    const undo = await timer.onSet(minutes);
                    if (!undo) { setApplied(false); return null; }
                    return { undo: async () => { const ok = await undo.undo(); if (ok) setApplied(false); return ok; } };
                }}
            />
            {!applied && (
                <button type="button" className="fx-link fx-link--muted focus-ring" onClick={() => setKept(true)} data-testid="focus-coach-keep-timer">
                    {tr('focus.coach.keepTimer', 'Keep {{time}}').replace('{{time}}', String(timer.minutes))}
                </button>
            )}
        </div>
    );
}

function StepsBlock({ api, tr }: { api: FocusCoachApi; tr: Tr }) {
    const { steps, suggested } = api;
    if (steps.state === 'dismissed') return null;
    if (steps.state === 'offered') {
        return (
            <div className="fx-coach-row" data-testid="focus-coach-steps">
                <button type="button" className="fx-link inline-flex items-center gap-1 focus-ring" onClick={api.revealSteps} data-testid="focus-coach-more-steps">
                    <ListPlus className="h-3.5 w-3.5" aria-hidden />{tr('focus.coach.suggestMore', 'Suggest more steps')}
                </button>
            </div>
        );
    }
    if (steps.state === 'removed') {
        return (
            <div className="fx-coach-steps" data-testid="focus-coach-steps">
                <span className="fx-done-line" role="status" data-testid="focus-coach-steps-note">
                    {tr('focus.coach.stepsRemoved', 'Removed the steps')}
                    <button type="button" className="fx-link focus-ring" onClick={() => { void api.undoSteps(); }}>{tr('common.undo', 'Undo')}</button>
                </span>
            </div>
        );
    }
    if (steps.state === 'added') {
        const count = steps.ids?.length ?? 0;
        const note = steps.auto && count
            ? tr('focus.coach.stepsAdded', 'Added {{count}} steps').replace('{{count}}', String(count))
            : tr('focus.coach.added', 'Added to the checklist');
        return (
            <div className="fx-coach-steps" data-testid="focus-coach-steps">
                <div className="fx-coach-row">
                    <span className="fx-done-line" role="status" data-testid="focus-coach-steps-note">
                        <Check className="h-3.5 w-3.5 text-success-text" aria-hidden />
                        {note}
                        <button type="button" className="fx-link focus-ring" onClick={() => { void api.undoSteps(); }}>{tr('common.undo', 'Undo')}</button>
                    </span>
                </div>
            </div>
        );
    }
    if (suggested.length === 0) return null;
    return (
        <div className="fx-coach-steps" data-leaving={steps.state === 'leaving' ? 'true' : undefined} data-testid="focus-coach-steps">
            <p className="fx-coach-label">{tr('focus.coach.stepsSuggested', 'Suggested steps')}</p>
            <ol>
                {suggested.map((step) => (
                    <li key={step.title}>
                        <span>{step.title}</span>
                        {step.source && <span className="fx-coach-source">{step.source}</span>}
                    </li>
                ))}
            </ol>
            <div className="fx-coach-row">
                <button type="button" className="fx-chip fx-chip--accent focus-ring" disabled={steps.state === 'adding' || steps.state === 'leaving'} onClick={() => { void api.addSteps(); }}>
                    {tr('focus.coach.addSteps', 'Add to checklist')}
                </button>
            </div>
        </div>
    );
}

export function FocusCoachCard({ api, tr, timer }: { api: FocusCoachApi; tr: Tr; timer?: FocusCoachTimer }) {
    const { coach, status, exchanges, collapsed } = api;
    if (status === 'idle' || status === 'dismissed') return null;
    // One feedback row for the card. A negative rating takes the steps off first (with Undo), so the
    // coach itself stays; a second one dismisses it.
    const hasStepsToReject = (api.steps.state === 'added' && Boolean(api.steps.auto)) || (api.steps.state !== 'dismissed' && api.steps.state !== 'added' && api.steps.state !== 'offered' && api.suggested.length > 0);
    const rate = (verdict: FocusCoachFeedbackVerdict) => {
        if (verdict !== 'useful' && hasStepsToReject) api.rateSteps(verdict);
        else api.rateCoach(verdict);
    };
    if (status === 'loading' || !coach) {
        return (
            <div className="fx-coach" data-testid="focus-coach" data-state="loading">
                <p className="fx-loading" role="status">
                    <Sparkles className="h-4 w-4 text-accent-text" aria-hidden />
                    <span className="fx-shimmer-text">{tr('focus.coach.thinking', 'Sizing this up…')}</span>
                </p>
            </div>
        );
    }

    const estimate = coach.estimateMinutes
        ? tr('focus.coach.about', 'About {{time}}').replace('{{time}}', formatFocusCoachMinutes(coach.estimateMinutes, tr))
        : null;

    // Without AI the coach is one short motivating line: no question, chips, reply box or feedback.
    if (coach.source === 'fallback') {
        return (
            <div className="fx-coach" data-testid="focus-coach" data-state={status} data-source="fallback" data-leaving={status === 'leaving' ? 'true' : undefined}>
                {estimate && (
                    <p className="fx-coach-estimate" data-testid="focus-coach-estimate">
                        <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        <span className="font-medium text-foreground">{estimate}</span>
                        {coach.estimateNote && <span className="min-w-0 truncate">· {coach.estimateNote}</span>}
                    </p>
                )}
                <p className="fx-coach-lead" data-testid="focus-coach-lead">{coach.motivation}</p>
            </div>
        );
    }
    const lead = coach.approach?.text ?? coach.motivation;
    const toggleLabel = collapsed ? tr('focus.coach.expand', 'Show coach') : tr('focus.coach.collapse', 'Hide coach');
    const firstAnswer = exchanges[0]?.answer;

    let body: ReactNode = null;
    if (!collapsed) {
        body = (
            <div className="fx-coach-body" id="fx-coach-body">
                {coach.approach && <p className="fx-coach-line">{coach.motivation}</p>}
                {coach.question && (
                    <div className="fx-coach-ask">
                        <p className="fx-coach-q">{coach.question.text}</p>
                        {!firstAnswer && (
                            <div className="fx-chips" role="group" aria-label={coach.question.text}>
                                {coach.question.options.map((option) => (
                                    <button key={option} type="button" className="fx-chip focus-ring" onClick={() => { void api.answer(option); }}>
                                        {option}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                <StepsBlock api={api} tr={tr} />

                {exchanges.map((exchange) => (
                    <div key={exchange.id} className="fx-coach-turn" data-leaving={exchange.leaving ? 'true' : undefined} data-testid="focus-coach-turn">
                        <p className="fx-coach-you"><span className="sr-only">{tr('focus.coach.you', 'You')}: </span>{exchange.answer}</p>
                        {exchange.reply ? (
                            <>
                                <p className="fx-coach-line fx-coach-line--strong" data-testid="focus-coach-reply">{exchange.reply.reply}</p>
                                {exchange.reply.steps && exchange.reply.steps.length > 0 && (
                                    <ol className="fx-coach-newsteps" data-testid="focus-coach-new-steps">
                                        {exchange.reply.steps.map((step) => <li key={step.title}>{step.title}</li>)}
                                    </ol>
                                )}
                                <div className="fx-coach-row fx-coach-row--tight">
                                    <div className="fx-chips">
                                        {exchange.reply.steps && exchange.reply.steps.length > 0 && (
                                            <OfferChip
                                                primary
                                                label={tr('focus.coach.updateSteps', 'Update steps')}
                                                doneLabel={tr('focus.coach.stepsUpdated', 'Steps updated')}
                                                tr={tr}
                                                testId="focus-coach-update-steps"
                                                onApply={() => api.updateSteps(exchange.reply!.steps!)}
                                            />
                                        )}
                                        {timer && exchange.reply.timerMinutes && (
                                            <OfferChip
                                                label={tr('focus.coach.setTimer', 'Set timer to {{time}}').replace('{{time}}', formatFocusCoachMinutes(exchange.reply.timerMinutes, tr))}
                                                doneLabel={tr('focus.coach.timerSet', 'Timer set to {{time}}').replace('{{time}}', formatFocusCoachMinutes(exchange.reply.timerMinutes, tr))}
                                                tr={tr}
                                                testId="focus-coach-action"
                                                onApply={() => timer.onSet(exchange.reply!.timerMinutes!)}
                                            />
                                        )}
                                        {exchange.reply.actions.map((action, index) => (
                                            <OfferChip
                                                key={`${action.type}-${index}`}
                                                label={focusActionLabel(action, tr)}
                                                tr={tr}
                                                testId="focus-coach-action"
                                                onApply={() => api.applyAction(action)}
                                            />
                                        ))}
                                    </div>
                                    <Feedback tr={tr} value={exchange.feedback} onRate={(v) => api.rateReply(exchange.id, v)} compact testId="focus-coach-reply-feedback" />
                                </div>
                            </>
                        ) : (
                            <p className="fx-loading fx-loading--sm" role="status">
                                <span className="fx-shimmer-text">{tr('focus.coach.thinkingShort', 'Thinking…')}</span>
                            </p>
                        )}
                    </div>
                ))}

                {api.canReply && (
                    <ReplyInput
                        tr={tr}
                        onSend={(text) => { void api.answer(text); }}
                        label={tr('focus.coach.reply', 'Reply to the coach')}
                        placeholder={firstAnswer || !coach.question ? tr('focus.coach.replyMore', 'Anything else on your mind?') : tr('focus.coach.replyPlaceholder', 'Or type a short answer')}
                    />
                )}
                <Feedback tr={tr} value={api.coachFeedback} onRate={rate} testId="focus-coach-feedback" />
            </div>
        );
    }

    return (
        <div className="fx-coach" data-testid="focus-coach" data-state={status} data-source={coach.source} data-leaving={status === 'leaving' ? 'true' : undefined}>
            <div className="fx-coach-head">
                <div className="min-w-0 flex-1">
                    {estimate && (
                        <p className="fx-coach-estimate" data-testid="focus-coach-estimate">
                            <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
                            <span className="font-medium text-foreground">{estimate}</span>
                            {coach.estimateNote && <span className="min-w-0 truncate">· {coach.estimateNote}</span>}
                        </p>
                    )}
                    <p className={cn('fx-coach-lead', collapsed && 'truncate')} data-testid="focus-coach-lead">{lead}</p>
                    {!collapsed && timer && coach.estimateMinutes && (
                        <EstimateOffer minutes={coach.estimateMinutes} timer={timer} tr={tr} />
                    )}
                </div>
                <button
                    type="button"
                    onClick={api.toggleCollapsed}
                    aria-expanded={!collapsed}
                    aria-controls="fx-coach-body"
                    aria-label={toggleLabel}
                    title={toggleLabel}
                    className="fx-icon-btn focus-ring"
                >
                    <ChevronDown className={cn('h-4 w-4 transition-transform', !collapsed && 'rotate-180')} aria-hidden />
                </button>
            </div>
            {body}
        </div>
    );
}
