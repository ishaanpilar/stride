import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CalendarSyncSection, describeCalendarSyncStatus, type CalendarSyncSectionLabels, type CalendarSyncSectionProps } from './CalendarSyncSection';

const t: CalendarSyncSectionLabels = {
    calendarSyncTitle: 'Sync to your calendar',
    calendarSyncExplain: 'Stride writes to a calendar called Stride in the account you pick. Google Calendar and your iPhone show it once that account syncs.',
    calendarSyncOneWay: 'One-way note',
    calendarSyncStatusLabel: 'Status',
    calendarSyncStatusOff: 'Off',
    calendarSyncStatusNeedsPermission: 'Needs permission',
    calendarSyncStatusSyncing: 'Syncing...',
    calendarSyncStatusSynced: 'Synced {time}',
    calendarSyncStatusError: 'Sync problem: {error}',
    calendarSyncStatusWaiting: 'Waiting',
    calendarSyncAccount: 'Account',
    calendarSyncAccountAuto: 'Automatic',
    calendarSyncNow: 'Sync now',
    calendarSyncOpenSettings: 'Open System Settings',
    calendarSyncPermissionBanner: 'Calendar access is off',
    calendarSyncNoAccounts: 'No accounts',
    calendarPushRefresh: 'Refresh',
    calendarPushLoading: 'Loading...',
};

const makeSync = (overrides: Partial<CalendarSyncSectionProps> = {}): CalendarSyncSectionProps => ({
    enabled: true,
    loading: false,
    status: { kind: 'synced', at: '2026-01-01T12:04:00.000Z' },
    accounts: [
        {
            accountId: 's-g', accountName: 'me@gmail.com', type: 'caldav',
            calendars: [{ id: 'c1', name: 'Home', sourceId: 's-g', sourceName: 'me@gmail.com', isStrideDedicated: false }],
            strideCalendar: null,
        },
    ],
    accountId: null,
    targetCalendarId: null,
    onToggle: vi.fn(),
    onDestinationChange: vi.fn(),
    onSyncNow: vi.fn(),
    onRefresh: vi.fn(),
    onOpenPrivacySettings: vi.fn(),
    formatTime: () => '12:04',
    ...overrides,
});

describe('CalendarSyncSection', () => {
    it('shows the explanation, the Google account, the synced time and syncs on demand', () => {
        const sync = makeSync();
        render(<CalendarSyncSection t={t} sync={sync} />);
        expect(screen.getByText(/called Stride in the account you pick/)).toBeTruthy();
        expect(screen.getByText('Synced 12:04')).toBeTruthy();
        expect(screen.getByRole('option', { name: 'Stride (me@gmail.com)' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
        expect(sync.onSyncNow).toHaveBeenCalled();
    });

    it('picks an account for the Stride calendar and an existing calendar separately', () => {
        const sync = makeSync();
        render(<CalendarSyncSection t={t} sync={sync} />);
        const select = screen.getByLabelText('Account') as HTMLSelectElement;
        fireEvent.change(select, { target: { value: 'account:s-g' } });
        expect(sync.onDestinationChange).toHaveBeenLastCalledWith({ accountId: 's-g', calendarId: null });
        fireEvent.change(select, { target: { value: 'calendar:c1' } });
        expect(sync.onDestinationChange).toHaveBeenLastCalledWith({ accountId: 's-g', calendarId: 'c1' });
        fireEvent.change(select, { target: { value: '' } });
        expect(sync.onDestinationChange).toHaveBeenLastCalledWith({ accountId: null, calendarId: null });
    });

    it('shows a permission banner with a button that opens System Settings', () => {
        const sync = makeSync({ status: { kind: 'needs-permission', denied: true } });
        render(<CalendarSyncSection t={t} sync={sync} />);
        expect(screen.getByRole('alert').textContent).toContain('Calendar access is off');
        fireEvent.click(screen.getByRole('button', { name: 'Open System Settings' }));
        expect(sync.onOpenPrivacySettings).toHaveBeenCalled();
        expect(screen.queryByRole('button', { name: 'Sync now' })).toBeNull();
    });

    it('shows Off and hides the pickers when disabled; toggling calls back', () => {
        const sync = makeSync({ enabled: false, status: { kind: 'off' } });
        render(<CalendarSyncSection t={t} sync={sync} />);
        expect(screen.getByRole('status').textContent).toContain('Off');
        expect(screen.queryByLabelText('Account')).toBeNull();
        fireEvent.click(screen.getByRole('switch', { name: 'Sync to your calendar' }));
        expect(sync.onToggle).toHaveBeenCalledWith(true);
    });

    it('formats every status kind', () => {
        const f = () => '09:00';
        expect(describeCalendarSyncStatus(t, { kind: 'error', message: 'boom' }, f)).toBe('Sync problem: boom');
        expect(describeCalendarSyncStatus(t, { kind: 'syncing' }, f)).toBe('Syncing...');
        expect(describeCalendarSyncStatus(t, { kind: 'waiting' }, f)).toBe('Waiting');
    });
});
