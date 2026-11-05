/**
 * Pure helpers for the "Sync to your calendar" settings section.
 * No I/O: the desktop host feeds in what it knows and renders the result.
 */

export type CalendarSyncPermission = 'undetermined' | 'granted' | 'denied' | 'unsupported';

export type CalendarSyncStatusInput = {
    enabled: boolean;
    permission: CalendarSyncPermission;
    syncing: boolean;
    /** ISO timestamp of the last fully successful run, if any. */
    lastSyncAt: string | null;
    /** Short machine-safe error code or message from the last run, if it failed. */
    lastError: string | null;
};

export type CalendarSyncStatus =
    | { kind: 'off' }
    | { kind: 'needs-permission'; denied: boolean }
    | { kind: 'syncing' }
    | { kind: 'error'; message: string }
    | { kind: 'synced'; at: string }
    | { kind: 'waiting' };

export function deriveCalendarSyncStatus(input: CalendarSyncStatusInput): CalendarSyncStatus {
    if (!input.enabled) return { kind: 'off' };
    if (input.permission === 'denied' || input.permission === 'undetermined') {
        return { kind: 'needs-permission', denied: input.permission === 'denied' };
    }
    if (input.syncing) return { kind: 'syncing' };
    const error = input.lastError?.trim();
    if (error) return { kind: 'error', message: error };
    if (input.lastSyncAt) return { kind: 'synced', at: input.lastSyncAt };
    return { kind: 'waiting' };
}

export type CalendarAccountSource = { id: string; name: string; type?: string };
export type CalendarAccountTarget = {
    id: string;
    name: string;
    sourceId?: string;
    sourceName?: string;
    isStrideDedicated?: boolean;
};
export type CalendarAccountGroup<T extends CalendarAccountTarget = CalendarAccountTarget> = {
    /** EventKit source id, or the source name when the id is unknown. */
    accountId: string;
    accountName: string;
    type?: string;
    calendars: T[];
    strideCalendar: T | null;
};

/**
 * Groups writable calendars by account so the user can recognise their Google
 * account (EventKit titles CalDAV/Google sources with the account email).
 * Accounts with no writable calendar yet are still listed so a Stride calendar
 * can be created inside them.
 */
export function groupCalendarTargetsByAccount<T extends CalendarAccountTarget>(
    sources: readonly CalendarAccountSource[],
    targets: readonly T[],
): CalendarAccountGroup<T>[] {
    const groups = new Map<string, CalendarAccountGroup<T>>();
    for (const source of sources) {
        groups.set(source.id, {
            accountId: source.id,
            accountName: source.name,
            type: source.type,
            calendars: [],
            strideCalendar: null,
        });
    }
    for (const target of targets) {
        const key = target.sourceId ?? target.sourceName ?? '';
        if (!key) continue;
        let group = groups.get(key);
        if (!group) {
            group = { accountId: key, accountName: target.sourceName ?? key, calendars: [], strideCalendar: null };
            groups.set(key, group);
        }
        group.calendars.push(target);
        if (target.isStrideDedicated && !group.strideCalendar) group.strideCalendar = target;
    }
    return [...groups.values()].sort((a, b) => a.accountName.localeCompare(b.accountName));
}

/** "Google" CalDAV accounts are the ones whose EventKit title is an email address. */
export function describeCalendarAccount(group: Pick<CalendarAccountGroup, 'accountName' | 'type'>): string {
    const type = group.type ?? '';
    const label = type === 'icloud' ? 'iCloud' : type === 'local' ? 'On My Mac' : type === 'exchange' ? 'Exchange' : '';
    return label && !group.accountName.includes(label) ? `${group.accountName} (${label})` : group.accountName;
}
