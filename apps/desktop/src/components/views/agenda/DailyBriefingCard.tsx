import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { shallow, useTaskStore, type Task } from '@stride/core';

import { useLanguage } from '../../../contexts/language-context';
import {
    ensureDailyBriefing,
    hasAttemptedDailyBriefingToday,
    isDailyBriefingEnabled,
    readCachedDailyBriefing,
    subscribeDailyBriefing,
} from '../../../lib/daily-briefing-service';

/** AI morning briefing for the Focus view. Renders nothing unless AI + the briefing toggle are on. */
export function DailyBriefingCard() {
    const { language } = useLanguage();
    const { aiEnabled, briefingOn, tasks } = useTaskStore((state) => ({
        aiEnabled: state.settings.ai?.enabled === true,
        briefingOn: state.settings.ai?.morningBriefing,
        tasks: state.tasks,
    }), shallow);
    const enabled = aiEnabled && briefingOn !== false;
    const cacheVersion = useSyncExternalStore(
        subscribeDailyBriefing,
        () => readCachedDailyBriefing()?.generatedAt ?? '',
        () => '',
    );
    const cached = enabled ? readCachedDailyBriefing() : null;
    const [loading, setLoading] = useState(false);
    const [failed, setFailed] = useState(false);

    const run = useCallback(async (force: boolean) => {
        setLoading(true);
        setFailed(false);
        const result = await ensureDailyBriefing({ force, language });
        setLoading(false);
        setFailed(!result);
    }, [language]);

    useEffect(() => {
        if (!enabled || !isDailyBriefingEnabled()) return;
        if (readCachedDailyBriefing() || hasAttemptedDailyBriefingToday()) return;
        void run(false);
    }, [enabled, run, cacheVersion]);

    if (!enabled) return null;
    const briefing = cached?.briefing;
    const titleOf = (id: string) => tasks.find((task: Task) => task.id === id && !task.deletedAt)?.title;
    const top = (briefing?.top ?? []).filter((item) => titleOf(item.taskId));

    return (
        <section className="rounded-card bg-card shadow-soft-sm p-5 space-y-3" aria-label="AI morning briefing" data-testid="daily-briefing-card">
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                    <Sparkles className="h-4 w-4 text-accent-text shrink-0" />
                    <h3 className="text-sm font-semibold truncate">{briefing?.headline || 'Morning briefing'}</h3>
                </div>
                <button
                    type="button"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-control hover:bg-accent text-muted-foreground focus-ring disabled:opacity-50"
                    onClick={() => void run(true)}
                    disabled={loading}
                    aria-label="Regenerate briefing"
                    title="Regenerate"
                >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                </button>
            </div>
            {!briefing && !loading && (
                <p className="text-xs text-muted-foreground">
                    {failed ? 'Could not generate a briefing right now. Try Regenerate.' : 'No briefing yet today.'}
                </p>
            )}
            {!briefing && loading && (
                <div className="space-y-2" aria-hidden="true" data-briefing-skeleton>
                    <div className="motion-skeleton h-3.5 w-4/5 rounded" />
                    <div className="motion-skeleton h-3.5 w-3/5 rounded" />
                    <div className="motion-skeleton h-3.5 w-2/3 rounded" />
                </div>
            )}
            {top.length > 0 && (
                <ol className="motion-expand-in space-y-1.5 text-sm">
                    {top.map((item, index) => (
                        <li key={item.taskId} className="flex gap-2">
                            <span className="text-muted-foreground tabular-nums">{index + 1}.</span>
                            <span className="text-left">
                                <span className="font-medium">{titleOf(item.taskId)}</span>
                                {item.why ? <span className="text-muted-foreground"> - {item.why}</span> : null}
                                {item.estimateMinutes ? <span className="text-muted-foreground"> ({item.estimateMinutes}m)</span> : null}
                            </span>
                        </li>
                    ))}
                </ol>
            )}
            {briefing && briefing.schedule.length > 0 && (
                <ul className="text-xs text-muted-foreground space-y-0.5">
                    {briefing.schedule.map((entry, index) => (
                        <li key={`${entry.time}-${index}`}><span className="tabular-nums">{entry.time}</span> {entry.title}</li>
                    ))}
                </ul>
            )}
            {briefing?.suggestion ? <p className="text-xs italic text-muted-foreground">{briefing.suggestion}</p> : null}
        </section>
    );
}
