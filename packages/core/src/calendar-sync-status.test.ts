import { describe, expect, it } from 'vitest';
import {
    deriveCalendarSyncStatus,
    describeCalendarAccount,
    groupCalendarTargetsByAccount,
} from './calendar-sync-status';

const base = { enabled: true, permission: 'granted' as const, syncing: false, lastSyncAt: null, lastError: null };

describe('deriveCalendarSyncStatus', () => {
    it('is off when disabled, whatever else is true', () => {
        expect(deriveCalendarSyncStatus({ ...base, enabled: false, permission: 'denied' })).toEqual({ kind: 'off' });
    });
    it('needs permission when access is denied or undetermined', () => {
        expect(deriveCalendarSyncStatus({ ...base, permission: 'denied' })).toEqual({ kind: 'needs-permission', denied: true });
        expect(deriveCalendarSyncStatus({ ...base, permission: 'undetermined' })).toEqual({ kind: 'needs-permission', denied: false });
    });
    it('reports syncing, then error, then synced, then waiting', () => {
        expect(deriveCalendarSyncStatus({ ...base, syncing: true }).kind).toBe('syncing');
        expect(deriveCalendarSyncStatus({ ...base, lastError: 'boom', lastSyncAt: 'x' })).toEqual({ kind: 'error', message: 'boom' });
        expect(deriveCalendarSyncStatus({ ...base, lastSyncAt: '2026-01-01T10:00:00.000Z' })).toEqual({ kind: 'synced', at: '2026-01-01T10:00:00.000Z' });
        expect(deriveCalendarSyncStatus(base)).toEqual({ kind: 'waiting' });
    });
});

describe('groupCalendarTargetsByAccount', () => {
    const sources = [
        { id: 's-g', name: 'me@gmail.com', type: 'caldav' },
        { id: 's-i', name: 'iCloud', type: 'icloud' },
        { id: 's-empty', name: 'Exchange Work', type: 'exchange' },
    ];
    const targets = [
        { id: 'c1', name: 'Home', sourceId: 's-g', sourceName: 'me@gmail.com' },
        { id: 'c2', name: 'Stride', sourceId: 's-g', sourceName: 'me@gmail.com', isStrideDedicated: true },
        { id: 'c3', name: 'Personal', sourceId: 's-i', sourceName: 'iCloud' },
        { id: 'c4', name: 'Orphan', sourceName: 'Other' },
    ];
    it('groups calendars under their account, keeps empty accounts, finds the Stride calendar', () => {
        const groups = groupCalendarTargetsByAccount(sources, targets);
        expect(groups.map((g) => g.accountName)).toEqual(['Exchange Work', 'iCloud', 'me@gmail.com', 'Other']);
        const google = groups.find((g) => g.accountId === 's-g')!;
        expect(google.calendars.map((c) => c.id)).toEqual(['c1', 'c2']);
        expect(google.strideCalendar?.id).toBe('c2');
        expect(groups.find((g) => g.accountId === 's-empty')!.calendars).toEqual([]);
    });
    it('describes accounts with their kind', () => {
        expect(describeCalendarAccount({ accountName: 'me@gmail.com', type: 'caldav' })).toBe('me@gmail.com');
        expect(describeCalendarAccount({ accountName: 'Mac', type: 'local' })).toBe('Mac (On My Mac)');
    });
});
