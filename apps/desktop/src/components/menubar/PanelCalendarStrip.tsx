import { useEffect, useState } from 'react';
import { safeFormatDate, type ExternalCalendarEvent } from '@stride/core';
import { fetchExternalCalendarEvents } from '../../lib/external-calendar-events';
import { isTauriRuntime } from '../../lib/runtime';

const MAX_VISIBLE = 3;

type StripEvent = ExternalCalendarEvent & { color?: string };

/** Today's calendar events (device + subscribed calendars) as a slim horizontal strip, read-only. */
export function PanelCalendarStrip({ refreshKey, allDayLabel, moreLabel, label }: {
    refreshKey: number;
    allDayLabel: string;
    moreLabel: (count: number) => string;
    /** Accessible name of the strip ("Today's calendar"). */
    label: string;
}) {
    const [events, setEvents] = useState<StripEvent[]>([]);

    useEffect(() => {
        if (!isTauriRuntime()) return;
        let cancelled = false;
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const end = new Date(start.getTime());
        end.setHours(23, 59, 59, 999);
        void fetchExternalCalendarEvents(start, end)
            .then(({ calendars, events: loaded }) => {
                if (cancelled) return;
                const colors = new Map(calendars.map((calendar) => [calendar.id, calendar.color || calendar.feedColor]));
                const now = Date.now();
                const todays = loaded
                    .filter((event) => {
                        const s = new Date(event.start).getTime();
                        const e = new Date(event.end).getTime();
                        return Number.isFinite(s) && s <= end.getTime() && (Number.isNaN(e) ? s : e) >= start.getTime();
                    })
                    // Hide events that already ended; all-day events stay.
                    .filter((event) => event.allDay || new Date(event.end).getTime() >= now)
                    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || new Date(a.start).getTime() - new Date(b.start).getTime())
                    .map((event) => ({ ...event, color: colors.get(event.sourceId) }));
                setEvents(todays);
            })
            .catch(() => { if (!cancelled) setEvents([]); });
        return () => { cancelled = true; };
    }, [refreshKey]);

    if (events.length === 0) return null;
    const visible = events.slice(0, MAX_VISIBLE);
    return (
        <ul
            className="-mx-1 mb-2 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            data-testid="menubar-calendar-strip"
            aria-label={label}
        >
            {visible.map((event) => (
                <li
                    key={event.id}
                    className="flex max-w-[240px] shrink-0 items-center gap-1.5 rounded-control bg-well px-2 py-1 text-xs shadow-soft-inset"
                    title={event.title}
                >
                    <span
                        aria-hidden
                        className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                        style={event.color ? { backgroundColor: event.color } : undefined}
                    />
                    <span className="shrink-0 font-semibold tabular-nums text-foreground">
                        {event.allDay ? allDayLabel : safeFormatDate(event.start, 'p')}
                    </span>
                    <span className="min-w-0 truncate text-muted-foreground">{event.title}</span>
                </li>
            ))}
            {events.length > visible.length && (
                <li className="flex shrink-0 items-center px-1 text-xs text-muted-foreground">{moreLabel(events.length - visible.length)}</li>
            )}
        </ul>
    );
}
