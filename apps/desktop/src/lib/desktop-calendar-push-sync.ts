


import {
    buildCalendarPushEventFields,
    getTaskCalendarOccurrenceDate,
    hasTimeComponent,
    isProjectedRecurringTask,
    runCalendarPushFullSync,
    runCalendarPushPartialSync,
    safeFormatDate,
    safeParseDate,
    resolveFeatureFlags,
    timeEstimateToMinutes,
    useTaskStore,
    type CalendarPushRunPorts,
    type CalendarSyncEntry,
    type Task,
} from '@stride/core';

import {
    CALENDAR_PUSH_SYNC_CONCURRENCY,
    createCalendarPushScheduler,
} from '@stride/core/calendar-push-scheduler';

import { logInfo, logWarn } from './app-log';
import { isTauriRuntime } from './runtime';
import { invokeNative } from './tauri-invoke';
import {
    createSystemCalendarEventResult,
    deleteSystemCalendarEventResult,
    ensureSystemStrideCalendar,
    getSystemCalendarPlatform,
    getSystemCalendarPermissionStatus,
    getSystemCalendarPushTargets,
    updateSystemCalendarEventResult,
    type SystemCalendarPlatform,
    type SystemCalendarEventDetails,
    type SystemCalendarEventWriteResult,
    type SystemCalendarPushTarget,
} from './system-calendar';

const DESKTOP_CALENDAR_PUSH_ENABLED_KEY = 'stride:desktop-calendar-push:enabled';
const DESKTOP_CALENDAR_PUSH_TARGET_ID_KEY = 'stride:desktop-calendar-push:target-calendar-id';
const DESKTOP_CALENDAR_PUSH_MANAGED_ID_KEY = 'stride:desktop-calendar-push:managed-calendar-id';
const DESKTOP_CALENDAR_PUSH_ACCOUNT_ID_KEY = 'stride:desktop-calendar-push:account-id';
const DESKTOP_CALENDAR_PUSH_LAST_SYNC_KEY = 'stride:desktop-calendar-push:last-sync-at';
const FOCUS_SYNC_MIN_INTERVAL_MS = 30_000;
const ACCOUNT_TARGET_TITLE_PREFIX = 'Stride: ';
const PROJECTED_RECURRENCE_EVENT_DATE_FORMAT = 'PP';

type CalendarPushTarget = {
    id: string;
    shouldPrefixTitles: boolean;
};

type DesktopCalendarPushDependencies = {
    createEvent: (details: SystemCalendarEventDetails) => Promise<SystemCalendarEventWriteResult>;
    deleteEvent: (eventId: string) => Promise<SystemCalendarEventWriteResult>;
    ensureStrideCalendar: (storedCalendarId?: string | null, sourceId?: string | null) => Promise<SystemCalendarPushTarget | null>;
    getAllSyncEntries: (platform: string) => Promise<CalendarSyncEntry[]>;
    getManagedCalendarId: () => Promise<string | null>;
    getPermissionStatus: typeof getSystemCalendarPermissionStatus;
    getPlatform: typeof getSystemCalendarPlatform;
    getPushEnabled: () => Promise<boolean>;
    getStoreState: typeof useTaskStore.getState;
    getSyncEntry: (taskId: string, platform: string) => Promise<CalendarSyncEntry | null>;
    getTargetCalendarId: () => Promise<string | null>;
    getTargets: () => Promise<SystemCalendarPushTarget[]>;
    nowIso: () => string;
    removeManagedCalendarId: () => Promise<void>;
    setManagedCalendarId: (calendarId: string) => Promise<void>;
    setPushEnabled: (enabled: boolean) => Promise<void>;
    setTargetCalendarId: (calendarId: string | null) => Promise<void>;
    subscribe: typeof useTaskStore.subscribe;
    updateEvent: (eventId: string, details: SystemCalendarEventDetails) => Promise<SystemCalendarEventWriteResult>;
    upsertSyncEntry: (entry: CalendarSyncEntry) => Promise<void>;
    deleteSyncEntry: (taskId: string, platform: string) => Promise<void>;
};

const readLocalStorage = (key: string): string | null => {
    if (typeof localStorage === 'undefined') return null;
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
};

const writeLocalStorage = (key: string, value: string): void => {
    if (typeof localStorage === 'undefined') return;
    try {
        localStorage.setItem(key, value);
    } catch {

    }
};

const removeLocalStorage = (key: string): void => {
    if (typeof localStorage === 'undefined') return;
    try {
        localStorage.removeItem(key);
    } catch {

    }
};

export const getDesktopCalendarPushEnabled = async (): Promise<boolean> => (
    readLocalStorage(DESKTOP_CALENDAR_PUSH_ENABLED_KEY) === '1'
);

export const setDesktopCalendarPushEnabled = async (enabled: boolean): Promise<void> => {
    writeLocalStorage(DESKTOP_CALENDAR_PUSH_ENABLED_KEY, enabled ? '1' : '0');
};

export const getDesktopCalendarPushTargetCalendarId = async (): Promise<string | null> => {
    const value = readLocalStorage(DESKTOP_CALENDAR_PUSH_TARGET_ID_KEY)?.trim() ?? '';
    return value.length > 0 ? value : null;
};

export const setDesktopCalendarPushTargetCalendarId = async (calendarId: string | null): Promise<void> => {
    const trimmed = calendarId?.trim() ?? '';
    if (!trimmed) {
        removeLocalStorage(DESKTOP_CALENDAR_PUSH_TARGET_ID_KEY);
        return;
    }
    writeLocalStorage(DESKTOP_CALENDAR_PUSH_TARGET_ID_KEY, trimmed);
};

export const getDesktopCalendarPushAccountId = async (): Promise<string | null> => {
    const value = readLocalStorage(DESKTOP_CALENDAR_PUSH_ACCOUNT_ID_KEY)?.trim() ?? '';
    return value.length > 0 ? value : null;
};

/** Choosing a different account forgets the old managed calendar so a Stride calendar is made in the new one. */
export const setDesktopCalendarPushAccountId = async (accountId: string | null): Promise<void> => {
    const trimmed = accountId?.trim() ?? '';
    const previous = await getDesktopCalendarPushAccountId();
    if (trimmed) writeLocalStorage(DESKTOP_CALENDAR_PUSH_ACCOUNT_ID_KEY, trimmed);
    else removeLocalStorage(DESKTOP_CALENDAR_PUSH_ACCOUNT_ID_KEY);
    if ((previous ?? '') !== trimmed) {
        await dependencies.removeManagedCalendarId();
    }
};

export type DesktopCalendarPushRuntimeStatus = {
    syncing: boolean;
    lastSyncAt: string | null;
    lastError: string | null;
};

let runtimeStatus: DesktopCalendarPushRuntimeStatus = {
    syncing: false,
    lastSyncAt: readLocalStorage(DESKTOP_CALENDAR_PUSH_LAST_SYNC_KEY),
    lastError: null,
};
const statusListeners = new Set<() => void>();

const updateRuntimeStatus = (patch: Partial<DesktopCalendarPushRuntimeStatus>): void => {
    runtimeStatus = { ...runtimeStatus, ...patch };
    statusListeners.forEach((listener) => listener());
};

export const getDesktopCalendarPushRuntimeStatus = (): DesktopCalendarPushRuntimeStatus => runtimeStatus;

export const subscribeDesktopCalendarPushRuntimeStatus = (listener: () => void): (() => void) => {
    statusListeners.add(listener);
    return () => { statusListeners.delete(listener); };
};

async function trackSyncRun(run: () => Promise<{ failed: number } | void>): Promise<void> {
    updateRuntimeStatus({ syncing: true });
    try {
        const result = await run();
        const failed = result && typeof result === 'object' ? result.failed : 0;
        if (failed > 0) {
            updateRuntimeStatus({ syncing: false, lastError: `${failed} task(s) could not be synced` });
            return;
        }
        const at = dependencies.nowIso();
        writeLocalStorage(DESKTOP_CALENDAR_PUSH_LAST_SYNC_KEY, at);
        updateRuntimeStatus({ syncing: false, lastSyncAt: at, lastError: null });
    } catch (error) {
        updateRuntimeStatus({ syncing: false, lastError: error instanceof Error ? error.message : String(error) });
        throw error;
    }
}

const getDesktopCalendarPushManagedCalendarId = async (): Promise<string | null> => {
    const value = readLocalStorage(DESKTOP_CALENDAR_PUSH_MANAGED_ID_KEY)?.trim() ?? '';
    return value.length > 0 ? value : null;
};

const setDesktopCalendarPushManagedCalendarId = async (calendarId: string): Promise<void> => {
    writeLocalStorage(DESKTOP_CALENDAR_PUSH_MANAGED_ID_KEY, calendarId);
};

const removeDesktopCalendarPushManagedCalendarId = async (): Promise<void> => {
    removeLocalStorage(DESKTOP_CALENDAR_PUSH_MANAGED_ID_KEY);
};

const getCalendarSyncEntry = async (taskId: string, platform: string): Promise<CalendarSyncEntry | null> => (
    invokeNative<CalendarSyncEntry | null>('get_calendar_sync_entry', { taskId, platform })
);

const upsertCalendarSyncEntry = async (entry: CalendarSyncEntry): Promise<void> => {
    await invokeNative('upsert_calendar_sync_entry', { entry });
};

const deleteCalendarSyncEntry = async (taskId: string, platform: string): Promise<void> => {
    await invokeNative('delete_calendar_sync_entry', { taskId, platform });
};

const getAllCalendarSyncEntries = async (platform: string): Promise<CalendarSyncEntry[]> => (
    invokeNative<CalendarSyncEntry[]>('get_all_calendar_sync_entries', { platform })
);

const defaultDependencies: DesktopCalendarPushDependencies = {
    createEvent: createSystemCalendarEventResult,
    deleteEvent: deleteSystemCalendarEventResult,
    deleteSyncEntry: deleteCalendarSyncEntry,
    ensureStrideCalendar: ensureSystemStrideCalendar,
    getAllSyncEntries: getAllCalendarSyncEntries,
    getManagedCalendarId: getDesktopCalendarPushManagedCalendarId,
    getPermissionStatus: getSystemCalendarPermissionStatus,
    getPlatform: getSystemCalendarPlatform,
    getPushEnabled: getDesktopCalendarPushEnabled,
    getStoreState: useTaskStore.getState,
    getSyncEntry: getCalendarSyncEntry,
    getTargetCalendarId: getDesktopCalendarPushTargetCalendarId,
    getTargets: getSystemCalendarPushTargets,
    nowIso: () => new Date().toISOString(),
    removeManagedCalendarId: removeDesktopCalendarPushManagedCalendarId,
    setManagedCalendarId: setDesktopCalendarPushManagedCalendarId,
    setPushEnabled: setDesktopCalendarPushEnabled,
    setTargetCalendarId: setDesktopCalendarPushTargetCalendarId,
    subscribe: useTaskStore.subscribe,
    updateEvent: updateSystemCalendarEventResult,
    upsertSyncEntry: upsertCalendarSyncEntry,
};

let dependencies: DesktopCalendarPushDependencies = { ...defaultDependencies };

export const getDesktopCalendarPushTargetCalendars = async (): Promise<SystemCalendarPushTarget[]> => {
    if (!isTauriRuntime()) return [];
    const permission = await dependencies.getPermissionStatus();
    if (permission !== 'granted') return [];
    return dependencies.getTargets();
};

const isStrideDedicatedTarget = (target: Pick<SystemCalendarPushTarget, 'isStrideDedicated' | 'name'>): boolean => (
    target.isStrideDedicated || target.name.trim().toLowerCase() === 'stride'
);

async function ensureDesktopStrideCalendar(): Promise<SystemCalendarPushTarget | null> {
    const storedCalendarId = await dependencies.getManagedCalendarId();
    const accountId = await getDesktopCalendarPushAccountId();
    const target = await dependencies.ensureStrideCalendar(storedCalendarId, accountId);
    if (!target) {
        await dependencies.removeManagedCalendarId();
        return null;
    }
    await dependencies.setManagedCalendarId(target.id);
    return target;
}

async function resolveCalendarPushTarget(): Promise<CalendarPushTarget | null> {
    const selectedId = await dependencies.getTargetCalendarId();
    if (selectedId) {
        const targets = await dependencies.getTargets();
        const selected = targets.find((target) => target.id === selectedId);
        if (selected) {
            return {
                id: selected.id,
                shouldPrefixTitles: !isStrideDedicatedTarget(selected),
            };
        }
        await dependencies.setTargetCalendarId(null);
        void logWarn('Selected system calendar push target is unavailable; falling back to Stride calendar', {
            scope: 'calendar-push',
            extra: { calendarId: selectedId },
        });
    }

    const managed = await ensureDesktopStrideCalendar();
    return managed ? { id: managed.id, shouldPrefixTitles: false } : null;
}

function buildAllDayBoundary(date: Date, dayOffset = 0): Date {
    const boundary = new Date(date);
    boundary.setHours(0, 0, 0, 0);
    boundary.setDate(boundary.getDate() + dayOffset);
    return boundary;
}

function buildAllDayEndOfDay(date: Date): Date {
    const boundary = new Date(date);
    boundary.setHours(23, 59, 59, 0);
    return boundary;
}

function formatLocalDateOnly(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatProjectedRecurrenceEventDate(task: Task): string {
    return safeFormatDate(getTaskCalendarOccurrenceDate(task), PROJECTED_RECURRENCE_EVENT_DATE_FORMAT);
}

function formatCalendarEventTitle(title: string, shouldPrefixTitle: boolean, occurrenceDateLabel = ''): string {
    const trimmed = title.trim() || 'Task';
    const datedTitle = occurrenceDateLabel ? `${trimmed} (${occurrenceDateLabel})` : trimmed;
    if (!shouldPrefixTitle) return datedTitle;
    if (trimmed.toLowerCase().startsWith(ACCOUNT_TARGET_TITLE_PREFIX.toLowerCase())) {
        return datedTitle;
    }
    return `${ACCOUNT_TARGET_TITLE_PREFIX}${datedTitle}`;
}

function formatProjectedRecurrenceNote(task: Task): string {
    const occurrenceDateLabel = formatProjectedRecurrenceEventDate(task);
    return occurrenceDateLabel
        ? `Projected recurring occurrence for ${occurrenceDateLabel}. Complete the current Stride task to create the real next task.`
        : 'Projected recurring occurrence. Complete the current Stride task to create the real next task.';
}

function buildEventDetails(task: Task, target: CalendarPushTarget): SystemCalendarEventDetails {
    const dateValue = task.startTime ?? task.dueDate;
    const parsed = safeParseDate(dateValue);
    const startDate = parsed ?? new Date();
    const location = typeof task.location === 'string' ? task.location.trim() : '';
    const projectedOccurrenceDateLabel = isProjectedRecurringTask(task)
        ? formatProjectedRecurrenceEventDate(task)
        : '';
    const { projects, sections, settings } = dependencies.getStoreState();
    const projectName = task.projectId
        ? projects.find((project) => project.id === task.projectId)?.title
        : undefined;
    const sectionName = task.sectionId
        ? sections.find((section) => section.id === task.sectionId)?.title
        : undefined;
    const leadingNote = isProjectedRecurringTask(task) ? formatProjectedRecurrenceNote(task) : undefined;


    const { notes } = buildCalendarPushEventFields(task, { projectName, sectionName, leadingNote });
    const title = formatCalendarEventTitle(task.title, target.shouldPrefixTitles, projectedOccurrenceDateLabel);

    if (hasTimeComponent(dateValue)) {


        const estimateMinutes = timeEstimateToMinutes(task.timeEstimate, {
            enabled: resolveFeatureFlags(settings).timeEstimates,
        });
        const endDate = new Date(startDate.getTime() + estimateMinutes * 60 * 1000);
        return {
            calendarId: target.id,
            title,
            start: startDate.toISOString(),
            end: endDate.toISOString(),
            allDay: false,
            notes,
            location,
        };
    }

    const allDayStart = buildAllDayBoundary(startDate);
    const allDayEnd = buildAllDayBoundary(startDate, 1);
    return {
        calendarId: target.id,
        title,
        start: allDayStart.toISOString(),


        end: buildAllDayEndOfDay(startDate).toISOString(),
        startDate: formatLocalDateOnly(allDayStart),
        endDate: formatLocalDateOnly(allDayEnd),
        allDay: true,
        notes,
        location,
    };
}

function isMissingCalendarEventResult(result: SystemCalendarEventWriteResult): boolean {
    return result.error === 'event-not-found';
}

function createCalendarPushRunPorts(target: CalendarPushTarget): CalendarPushRunPorts {
    const platform: SystemCalendarPlatform | null = dependencies.getPlatform();
    if (!platform) {
        throw new Error('system-calendar-unsupported');
    }
    return {
        platform,
        nowIso: dependencies.nowIso,
        createEvent: async (task) => {
            const result = await dependencies.createEvent(buildEventDetails(task, target));
            if (!result.ok || !result.eventId) {
                throw new Error(result.error ?? 'calendar-create-failed');
            }
            return result.eventId;
        },
        updateEvent: async (entry, task) => {
            const result = await dependencies.updateEvent(
                entry.calendarEventId,
                buildEventDetails(task, target)
            );
            if (result.ok && result.eventId) {
                return { status: 'updated', eventId: result.eventId };
            }
            if (isMissingCalendarEventResult(result)) {
                return { status: 'missing' };
            }
            void logWarn('Failed to update system calendar event; keeping local sync mapping for retry', {
                scope: 'calendar-push',
                extra: {
                    taskId: entry.taskId,
                    eventId: entry.calendarEventId,
                    error: result.error ?? 'unknown',
                },
            });
            throw new Error(result.error ?? 'calendar-update-failed');
        },
        deleteEvent: async (entry) => {
            const result = await dependencies.deleteEvent(entry.calendarEventId);
            if (result.ok || isMissingCalendarEventResult(result)) return;
            void logWarn('Failed to delete system calendar event; keeping local sync mapping for retry', {
                scope: 'calendar-push',
                extra: {
                    taskId: entry.taskId,
                    eventId: entry.calendarEventId,
                    error: result.error ?? 'unknown',
                },
            });
            throw new Error(result.error ?? 'calendar-delete-failed');
        },
        getSyncEntry: (taskId) => dependencies.getSyncEntry(taskId, platform),
        getAllSyncEntries: () => dependencies.getAllSyncEntries(platform),
        upsertSyncEntry: dependencies.upsertSyncEntry,
        deleteSyncEntry: (taskId) => dependencies.deleteSyncEntry(taskId, platform),
    };
}


const calendarPushScheduler = createCalendarPushScheduler({
    runFull: () => runFullDesktopCalendarPushSyncUnsafe(),
    runPartial: (taskIds) => runPartialDesktopCalendarPushSyncUnsafe(taskIds),
});

export const runFullDesktopCalendarPushSync = (): Promise<void> => calendarPushScheduler.runFull();

const runFullDesktopCalendarPushSyncUnsafe = (): Promise<void> => trackSyncRun(runFullDesktopCalendarPushSyncCore);

const runFullDesktopCalendarPushSyncCore = async (): Promise<{ failed: number } | void> => {
    if (!isTauriRuntime()) return;
    const enabled = await dependencies.getPushEnabled();
    if (!enabled) return;
    const permission = await dependencies.getPermissionStatus();
    if (permission !== 'granted') return;

    const target = await resolveCalendarPushTarget();
    if (!target) throw new Error('No writable calendar available in the chosen account');

    const { _allTasks } = dependencies.getStoreState();
    const result = await runCalendarPushFullSync({
        tasks: _allTasks as Task[],
        target,
        ports: createCalendarPushRunPorts(target),
        concurrency: CALENDAR_PUSH_SYNC_CONCURRENCY,
    });
    void logInfo('Full system calendar push sync complete', {
        scope: 'calendar-push',
        extra: {
            total: String(result.total),
            failed: String(result.failed),
            stale: String(result.stale),
            releaseCheck: 'v1.3.0/calendar-push-inventory',
        },
    });
    return { failed: result.failed + result.staleFailed };
};

export const scheduleDesktopCalendarPushSyncDebounced = (taskIds: string[]): void => {
    calendarPushScheduler.scheduleDebounced(taskIds);
};

const runPartialDesktopCalendarPushSyncUnsafe = (taskIds: string[]): Promise<void> => (
    // Failures are recorded in the runtime status (shown in settings); a background run must never throw unhandled.
    trackSyncRun(() => runPartialDesktopCalendarPushSyncCore(taskIds)).catch(() => undefined)
);

const runPartialDesktopCalendarPushSyncCore = async (taskIds: string[]): Promise<{ failed: number } | void> => {
    if (!isTauriRuntime()) return;
    const enabled = await dependencies.getPushEnabled();
    if (!enabled) return;
    const permission = await dependencies.getPermissionStatus();
    if (permission !== 'granted') return;

    const target = await resolveCalendarPushTarget();
    if (!target) throw new Error('No writable calendar available in the chosen account');

    const { _tasksById } = dependencies.getStoreState();
    const result = await runCalendarPushPartialSync({
        taskIds,
        tasksById: _tasksById as Map<string, Task>,
        target,
        ports: createCalendarPushRunPorts(target),
        concurrency: CALENDAR_PUSH_SYNC_CONCURRENCY,
    });
    return { failed: result.failed + result.removedFailed };
};

/** "Sync now" button: same serialized full sync the automatic runs use. */
export const syncDesktopCalendarPushNow = (): Promise<void> => runFullDesktopCalendarPushSync();

let unsubscribeStore: (() => void) | null = null;
let removeFocusListener: (() => void) | null = null;
let lastFocusSyncAt = 0;

const installFocusSync = (): void => {
    if (removeFocusListener || typeof window === 'undefined') return;
    const onFocus = () => {
        const now = Date.now();
        if (now - lastFocusSyncAt < FOCUS_SYNC_MIN_INTERVAL_MS) return;
        lastFocusSyncAt = now;
        void runFullDesktopCalendarPushSync().catch(() => undefined);
    };
    window.addEventListener('focus', onFocus);
    removeFocusListener = () => window.removeEventListener('focus', onFocus);
};

const buildCalendarSyncTaskMap = (tasks: Task[]) => new Map(tasks.map((task) => [task.id, task]));

export const startDesktopCalendarPushSync = (): (() => void) => {
    if (unsubscribeStore) return unsubscribeStore;
    installFocusSync();

    let previousTaskMap = buildCalendarSyncTaskMap(dependencies.getStoreState()._allTasks as Task[]);

    unsubscribeStore = dependencies.subscribe(
        (state) => state._allTasks,
        (currentTasks) => {
            const changedIds: string[] = [];
            const currentMap = buildCalendarSyncTaskMap(currentTasks as Task[]);

            for (const task of currentTasks as Task[]) {
                const prev = previousTaskMap.get(task.id);
                if (
                    !prev ||
                    prev.updatedAt !== task.updatedAt ||
                    prev.startTime !== task.startTime ||
                    prev.dueDate !== task.dueDate ||
                    prev.deletedAt !== task.deletedAt ||
                    prev.status !== task.status ||
                    prev.title !== task.title ||
                    prev.description !== task.description ||
                    prev.location !== task.location ||
                    prev.timeEstimate !== task.timeEstimate ||
                    prev.recurrence !== task.recurrence ||
                    prev.showFutureRecurrence !== task.showFutureRecurrence
                ) {
                    changedIds.push(task.id);
                }
            }

            for (const id of previousTaskMap.keys()) {
                if (!currentMap.has(id)) {
                    changedIds.push(id);
                }
            }

            previousTaskMap = currentMap;

            if (changedIds.length > 0) {
                scheduleDesktopCalendarPushSyncDebounced(changedIds);
            }
        }
    );

    return stopDesktopCalendarPushSync;
};

export const stopDesktopCalendarPushSync = (): void => {
    unsubscribeStore?.();
    unsubscribeStore = null;
    removeFocusListener?.();
    removeFocusListener = null;
    calendarPushScheduler.cancelPending();
};

export const __desktopCalendarPushSyncTestUtils = {
    resetForTests() {
        stopDesktopCalendarPushSync();
        calendarPushScheduler.reset();
        lastFocusSyncAt = 0;
        runtimeStatus = { syncing: false, lastSyncAt: null, lastError: null };
        dependencies = { ...defaultDependencies };
    },
    setDependenciesForTests(overrides: Partial<DesktopCalendarPushDependencies>) {
        dependencies = {
            ...dependencies,
            ...overrides,
        };
    },
};

export const enableDesktopCalendarPush = async (): Promise<boolean> => {
    if (!isTauriRuntime()) return false;
    const permission = await dependencies.getPermissionStatus();
    if (permission !== 'granted') return false;
    const selectedTargetId = await dependencies.getTargetCalendarId();
    if (!selectedTargetId) {
        const managed = await ensureDesktopStrideCalendar();
        if (!managed) return false;
    }
    await dependencies.setPushEnabled(true);
    startDesktopCalendarPushSync();
    try {
        await runFullDesktopCalendarPushSync();
        return true;
    } catch (error) {
        stopDesktopCalendarPushSync();
        await dependencies.setPushEnabled(false);
        throw error;
    }
};
