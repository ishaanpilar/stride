import { memo } from 'react';
import { AlertCircle, Sparkles } from 'lucide-react';
import { useTaskById } from '@stride/core';

import { useInboxSuggestions } from '../../../lib/inbox-process-service';
import { useCaptureText, type CaptureText } from '../../capture/useCaptureText';
import { inboxKindLabel } from './InboxProcessReview';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function formatCapturedAgo(t: CaptureText, iso: string | undefined, now: number = Date.now()): string | null {
    if (!iso) return null;
    const at = Date.parse(iso);
    if (Number.isNaN(at)) return null;
    const diff = Math.max(0, now - at);
    if (diff < MINUTE) return t('inboxHub.capturedNow', 'Captured just now');
    if (diff < HOUR) return t('inboxHub.capturedMinutes', 'Captured {{count}} min ago', { count: Math.floor(diff / MINUTE) });
    if (diff < DAY) return t('inboxHub.capturedHours', 'Captured {{count}} h ago', { count: Math.floor(diff / HOUR) });
    if (diff < 7 * DAY) return t('inboxHub.capturedDays', 'Captured {{count}} d ago', { count: Math.floor(diff / DAY) });
    const date = new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    return t('inboxHub.capturedOn', 'Captured {{date}}', { date });
}

/** One quiet line under an Inbox row: when it was captured, and the AI's last suggestion if any. */
export const InboxRowMeta = memo(function InboxRowMeta({ taskId }: { taskId: string }) {
    const t = useCaptureText();
    const task = useTaskById(taskId);
    const suggestions = useInboxSuggestions();
    if (!task || task.status !== 'inbox') return null;
    const captured = formatCapturedAgo(t, task.createdAt);
    const suggestion = suggestions[taskId];
    const destination = suggestion
        ? [inboxKindLabel(t, suggestion.kind), suggestion.projectName ?? suggestion.newProjectTitle ?? suggestion.areaName ?? suggestion.newAreaName]
            .filter(Boolean).join(' · ')
        : null;
    if (!captured && !suggestion) return null;
    return (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 pb-1 pt-1 text-[12px] leading-4 text-muted-foreground" data-inbox-row-meta={taskId}>
            {captured ? <span>{captured}</span> : null}
            {suggestion?.needsYou ? (
                <span className="inline-flex items-center gap-1 rounded-pill bg-warning-fill/10 px-2 py-0.5 font-medium text-warning-text"
                    title={suggestion.reason ? t('quickCapture.reason', 'Why: {{reason}}', { reason: suggestion.reason }) : undefined}>
                    <AlertCircle className="h-3 w-3" aria-hidden="true" />
                    {t('inboxHub.needsYouChip', 'Needs you')}
                    {destination ? <span className="font-normal">· {t('inboxHub.aiGuess', 'AI guess: {{destination}}', { destination })}</span> : null}
                </span>
            ) : destination ? (
                <span className="inline-flex items-center gap-1 rounded-pill bg-accent-soft px-2 py-0.5 font-medium text-accent-text"
                    title={suggestion?.reason ? t('quickCapture.reason', 'Why: {{reason}}', { reason: suggestion.reason }) : undefined}>
                    <Sparkles className="h-3 w-3" aria-hidden="true" />
                    {destination}
                </span>
            ) : null}
        </div>
    );
});
