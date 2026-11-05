import { describeCalendarAccount, type CalendarAccountGroup, type CalendarSyncStatus } from '@stride/core/calendar-sync-status';

import type { SystemCalendarPushTarget } from '../../../lib/system-calendar';
import { cn } from '../../../lib/utils';
import { Switch } from '../../ui/Switch';
import type { SettingsLabels } from './labels';

export type CalendarSyncSectionLabels = Pick<SettingsLabels,
    | 'calendarSyncTitle'
    | 'calendarSyncExplain'
    | 'calendarSyncOneWay'
    | 'calendarSyncStatusLabel'
    | 'calendarSyncStatusOff'
    | 'calendarSyncStatusNeedsPermission'
    | 'calendarSyncStatusSyncing'
    | 'calendarSyncStatusSynced'
    | 'calendarSyncStatusError'
    | 'calendarSyncStatusWaiting'
    | 'calendarSyncAccount'
    | 'calendarSyncAccountAuto'
    | 'calendarSyncNow'
    | 'calendarSyncOpenSettings'
    | 'calendarSyncPermissionBanner'
    | 'calendarSyncNoAccounts'
    | 'calendarPushRefresh'
    | 'calendarPushLoading'
>;

export type CalendarSyncSectionProps = {
    enabled: boolean;
    loading: boolean;
    status: CalendarSyncStatus;
    accounts: CalendarAccountGroup<SystemCalendarPushTarget>[];
    accountId: string | null;
    targetCalendarId: string | null;
    onToggle: (enabled: boolean) => Promise<void> | void;
    onDestinationChange: (destination: { accountId: string | null; calendarId: string | null }) => Promise<void> | void;
    onSyncNow: () => Promise<void> | void;
    onRefresh: () => Promise<void> | void;
    onOpenPrivacySettings: () => Promise<void> | void;
    formatTime: (iso: string) => string;
};

const ACCOUNT_PREFIX = 'account:';
const CALENDAR_PREFIX = 'calendar:';

export function describeCalendarSyncStatus(
    t: CalendarSyncSectionLabels,
    status: CalendarSyncStatus,
    formatTime: (iso: string) => string,
): string {
    switch (status.kind) {
        case 'off': return t.calendarSyncStatusOff;
        case 'needs-permission': return t.calendarSyncStatusNeedsPermission;
        case 'syncing': return t.calendarSyncStatusSyncing;
        case 'synced': return t.calendarSyncStatusSynced.replace('{time}', formatTime(status.at));
        case 'error': return t.calendarSyncStatusError.replace('{error}', status.message);
        case 'waiting': return t.calendarSyncStatusWaiting;
    }
}

export function CalendarSyncSection({ t, sync }: { t: CalendarSyncSectionLabels; sync: CalendarSyncSectionProps }) {
    const needsPermission = sync.status.kind === 'needs-permission' && sync.status.denied;
    const selectValue = sync.targetCalendarId
        ? `${CALENDAR_PREFIX}${sync.targetCalendarId}`
        : sync.accountId
            ? `${ACCOUNT_PREFIX}${sync.accountId}`
            : '';
    const handleChange = (value: string) => {
        if (value.startsWith(CALENDAR_PREFIX)) {
            const calendarId = value.slice(CALENDAR_PREFIX.length);
            const owner = sync.accounts.find((group) => group.calendars.some((calendar) => calendar.id === calendarId));
            void sync.onDestinationChange({ accountId: owner?.accountId ?? null, calendarId });
        } else if (value.startsWith(ACCOUNT_PREFIX)) {
            void sync.onDestinationChange({ accountId: value.slice(ACCOUNT_PREFIX.length), calendarId: null });
        } else {
            void sync.onDestinationChange({ accountId: null, calendarId: null });
        }
    };
    const statusText = describeCalendarSyncStatus(t, sync.status, sync.formatTime);

    return (
        <div data-settings-key="calendarSyncTitle" className="space-y-3" data-testid="calendar-sync-section">
            <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                    <div className="text-sm font-medium">{t.calendarSyncTitle}</div>
                    <p className="text-xs text-muted-foreground">{t.calendarSyncExplain}</p>
                </div>
                <Switch
                    aria-label={t.calendarSyncTitle}
                    checked={sync.enabled}
                    disabled={sync.loading}
                    onCheckedChange={sync.onToggle}
                />
            </div>

            {needsPermission && (
                <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-control bg-well shadow-soft-inset p-3">
                    <p className="text-xs text-danger-text">{t.calendarSyncPermissionBanner}</p>
                    <button
                        type="button"
                        onClick={() => void sync.onOpenPrivacySettings()}
                        className="text-sm px-3 py-2 rounded-control btn-gradient focus-ring"
                    >
                        {t.calendarSyncOpenSettings}
                    </button>
                </div>
            )}

            {sync.enabled && !needsPermission && (
                <>
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                        <label className="space-y-1">
                            <span className="text-sm font-medium">{t.calendarSyncAccount}</span>
                            <select
                                value={selectValue}
                                onChange={(event) => handleChange(event.target.value)}
                                disabled={sync.loading}
                                className="w-full text-sm px-3 py-2 bg-well shadow-soft-inset rounded-control focus-ring"
                            >
                                <option value="">{t.calendarSyncAccountAuto}</option>
                                {sync.accounts.map((group) => (
                                    <optgroup key={group.accountId} label={describeCalendarAccount(group)}>
                                        <option value={`${ACCOUNT_PREFIX}${group.accountId}`}>
                                            {`Stride (${group.accountName})`}
                                        </option>
                                        {group.calendars
                                            .filter((calendar) => !calendar.isStrideDedicated)
                                            .map((calendar) => (
                                                <option key={calendar.id} value={`${CALENDAR_PREFIX}${calendar.id}`}>
                                                    {calendar.name}
                                                </option>
                                            ))}
                                    </optgroup>
                                ))}
                            </select>
                            {sync.accounts.length === 0 && (
                                <span className="block text-xs text-muted-foreground">{t.calendarSyncNoAccounts}</span>
                            )}
                        </label>
                        <button
                            type="button"
                            onClick={() => void sync.onRefresh()}
                            disabled={sync.loading}
                            className="text-sm px-3 py-2 rounded-control border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-60"
                        >
                            {sync.loading ? t.calendarPushLoading : t.calendarPushRefresh}
                        </button>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="text-sm" role="status" aria-live="polite">
                            <span className="text-muted-foreground">{t.calendarSyncStatusLabel}: </span>
                            <span className={cn('font-medium', sync.status.kind === 'error' && 'text-danger-text')}>{statusText}</span>
                        </div>
                        <button
                            type="button"
                            onClick={() => void sync.onSyncNow()}
                            disabled={sync.loading || sync.status.kind === 'syncing'}
                            className="text-sm px-3 py-2 rounded-control btn-gradient focus-ring disabled:opacity-60"
                        >
                            {t.calendarSyncNow}
                        </button>
                    </div>
                    <p className="text-xs text-muted-foreground">{t.calendarSyncOneWay}</p>
                </>
            )}

            {!sync.enabled && (
                <div className="text-sm" role="status">
                    <span className="text-muted-foreground">{t.calendarSyncStatusLabel}: </span>
                    <span className="font-medium">{statusText}</span>
                </div>
            )}
        </div>
    );
}
