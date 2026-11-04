import { useEffect, useState } from 'react';
import { safeFormatDate, type ExternalCalendarEvent } from '@stride/core';
import { fetchExternalCalendarEvents } from '../../lib/external-calendar-events';
import { isTauriRuntime } from '../../lib/runtime';
import { cn } from '../../lib/utils';

const MAX_VISIBLE = 3;

type StripEvent = ExternalCalendarEvent & { color?: string };

/** Today's calendar events (device + subscribed calendars), read-only, same source as Calendar. */
export function PanelCalendarStrip({ refreshKey, allDayLabel, moreLabel }: {
    refreshKey: number;
    allDayLabel: string;
    moreLabel: (count: number) => string;
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
        <ul className="mb-2 space-y-1 px-1" data-testid="menubar-calendar-strip" aria-label="Calendar">
            {visible.map((event) => (
                <li
                    key={event.id}
                    className="flex items-center gap-2 rounded-control bg-foreground/[0.05] py-1.5 pl-2 pr-2.5"
                >
                    <span
                        aria-hidden
                        className={cn('h-5 w-[3px] shrink-0 rounded-full bg-primary')}
                        style={event.color ? { backgroundColor: event.color } : undefined}
                    />
                    <span className="w-[68px] shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
                        {event.allDay ? allDayLabel : safeFormatDate(event.start, 'p')}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs text-foreground">{event.title}</span>
                </li>
            ))}
            {events.length > visible.length && (
                <li className="px-2 text-xs text-muted-foreground">{moreLabel(events.length - visible.length)}</li>
            )}
        </ul>
    );
}
