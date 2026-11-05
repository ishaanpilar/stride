import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => [] as string[]);
const checkMock = vi.hoisted(() => vi.fn());
const relaunchMock = vi.hoisted(() => vi.fn(async () => {
    calls.push('relaunch');
}));
const flushMock = vi.hoisted(() => vi.fn(async () => {
    calls.push('flush');
}));

const manualCheckMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/plugin-updater', () => ({ check: checkMock }));
vi.mock('./app-updater', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./app-updater')>()),
    checkForManualAppUpdate: manualCheckMock,
}));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: relaunchMock }));
vi.mock('@stride/core', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@stride/core')>()),
    flushPendingSave: flushMock,
}));
vi.mock('./app-log', () => ({
    logError: vi.fn(async () => null),
    logInfo: vi.fn(async () => null),
}));

import { readAppUpdaterPrefs, updateAppUpdaterPrefs } from './app-updater-prefs';
import { resetAppUpdaterStoreForTests, useAppUpdaterStore } from './app-updater-store';
import { resetCloseFlushGate } from './close-flush-gate';

const DAY_MS = 24 * 60 * 60 * 1000;
const START = new Date('2026-11-05T09:00:00.000Z');

function fakeUpdate(version = '1.5.0', overrides: Record<string, unknown> = {}) {
    return {
        version,
        currentVersion: '1.4.1',
        body: '## Fixes\n- **Sync** is faster',
        date: '2026-11-05T08:00:00Z',
        downloadAndInstall: vi.fn(async (onEvent: (event: unknown) => void) => {
            calls.push('download');
            onEvent({ event: 'Started', data: { contentLength: 100 } });
            onEvent({ event: 'Progress', data: { chunkLength: 60 } });
            onEvent({ event: 'Progress', data: { chunkLength: 40 } });
            onEvent({ event: 'Finished' });
        }),
        ...overrides,
    };
}

const store = () => useAppUpdaterStore.getState();

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(START);
    (window as unknown as { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__ = {};
    window.localStorage.clear();
    calls.length = 0;
    checkMock.mockReset();
    manualCheckMock.mockReset();
    manualCheckMock.mockRejectedValue(new Error('GitHub API unreachable'));
    relaunchMock.mockClear();
    flushMock.mockClear();
    resetCloseFlushGate();
    resetAppUpdaterStoreForTests();
});

afterEach(() => {
    vi.useRealTimers();
    delete (window as unknown as { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__;
});

describe('app updater store', () => {
    it('checks, opens the dialog, installs with progress, saves, then relaunches', async () => {
        const update = fakeUpdate();
        checkMock.mockResolvedValue(update);

        await expect(store().checkNow()).resolves.toBe('available');
        expect(store().dialogOpen).toBe(true);
        expect(store().update).toMatchObject({ version: '1.5.0', currentVersion: '1.4.1' });
        expect(store().lastCheckedAt).toBe(START.toISOString());

        const progress: Array<string> = [];
        const unsubscribe = useAppUpdaterStore.subscribe((state) => progress.push(state.phase));
        await store().installUpdate();
        unsubscribe();

        expect(progress).toContain('downloading');
        expect(progress).toContain('installing');
        expect(progress).toContain('restarting');
        expect(store().progress).toEqual({ downloadedBytes: 100, totalBytes: 100 });
        expect(calls).toEqual(['download', 'flush', 'relaunch']);
        expect(readAppUpdaterPrefs().pendingWhatsNew).toEqual({ version: '1.5.0', notes: '## Fixes\n- **Sync** is faster' });
    });

    it('reports up to date and records the check time', async () => {
        checkMock.mockResolvedValue(null);
        await expect(store().checkNow({ manual: true })).resolves.toBe('up-to-date');
        expect(store().dialogOpen).toBe(false);
        expect(readAppUpdaterPrefs().lastCheckedAt).toBe(START.toISOString());
    });

    it('prompts automatically at most once per version per day', async () => {
        checkMock.mockResolvedValue(fakeUpdate());
        await expect(store().checkNow()).resolves.toBe('available');
        useAppUpdaterStore.setState({ dialogOpen: false });

        vi.setSystemTime(new Date(START.getTime() + 6 * 60 * 60 * 1000));
        await expect(store().checkNow()).resolves.toBe('suppressed');
        expect(store().dialogOpen).toBe(false);

        vi.setSystemTime(new Date(START.getTime() + DAY_MS));
        await expect(store().checkNow()).resolves.toBe('available');
    });

    it('Later snoozes that version for 24 hours, but a newer version still prompts', async () => {
        checkMock.mockResolvedValue(fakeUpdate());
        await store().checkNow();
        store().remindLater();
        expect(store().dialogOpen).toBe(false);
        expect(store().phase).toBe('available');

        vi.setSystemTime(new Date(START.getTime() + DAY_MS - 1000));
        await expect(store().checkNow()).resolves.toBe('suppressed');

        checkMock.mockResolvedValue(fakeUpdate('1.5.1'));
        await expect(store().checkNow()).resolves.toBe('available');
    });

    it('Skip hides that version from automatic checks; a manual check still shows it', async () => {
        checkMock.mockResolvedValue(fakeUpdate());
        await store().checkNow();
        store().skipVersion();
        expect(store().dialogOpen).toBe(false);

        vi.setSystemTime(new Date(START.getTime() + 30 * DAY_MS));
        await expect(store().checkNow()).resolves.toBe('suppressed');
        await expect(store().checkNow({ manual: true })).resolves.toBe('available');
        expect(store().dialogOpen).toBe(true);
    });

    it('does not start an automatic check while the dialog is open', async () => {
        checkMock.mockResolvedValue(fakeUpdate());
        await store().checkNow();
        checkMock.mockClear();
        await expect(store().checkNow()).resolves.toBe('busy');
        expect(checkMock).not.toHaveBeenCalled();
    });

    it('classifies check failures calmly without opening the dialog', async () => {
        checkMock.mockRejectedValue(new Error('error sending request for url (https://github.com/...)'));
        await expect(store().checkNow({ manual: true })).resolves.toBe('error');
        expect(store()).toMatchObject({ phase: 'error', errorKind: 'offline', errorStage: 'check', dialogOpen: false });

        checkMock.mockRejectedValue('Could not fetch a valid release JSON from the remote');
        await store().checkNow({ manual: true });
        expect(store().errorKind).toBe('unavailable');
    });

    it('offers a GitHub download when latest.json has no entry for this platform', async () => {
        checkMock.mockRejectedValue('the platform `windows-x86_64` was not found on the response `platforms` object');
        manualCheckMock.mockResolvedValue({
            version: '1.6.0',
            currentVersion: '1.5.0',
            notes: 'Windows beta',
            date: '2026-11-06T10:00:00Z',
            downloadOnly: true,
            downloadUrl: 'https://github.com/ishaanpilar/stride/releases/tag/v1.6.0',
        });
        await expect(store().checkNow()).resolves.toBe('available');
        expect(store()).toMatchObject({ phase: 'available', dialogOpen: true, errorKind: null });
        expect(store().update).toMatchObject({ version: '1.6.0', downloadOnly: true });

        // Nothing to install in-app: the install action is a no-op for a download-only update.
        await store().installUpdate();
        expect(calls).toEqual([]);
    });

    it('on Windows saves pending changes after download and before the installer closes the app', async () => {
        vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
        const update = fakeUpdate('1.6.0', {
            download: vi.fn(async (onEvent: (event: unknown) => void) => {
                calls.push('download');
                onEvent({ event: 'Started', data: { contentLength: 10 } });
                onEvent({ event: 'Finished' });
            }),
            install: vi.fn(async () => {
                calls.push('install');
            }),
        });
        checkMock.mockResolvedValue(update);
        await store().checkNow();
        await store().installUpdate();
        expect(calls).toEqual(['download', 'flush', 'install', 'relaunch']);
        expect(update.downloadAndInstall).not.toHaveBeenCalled();
        expect(readAppUpdaterPrefs().pendingWhatsNew?.version).toBe('1.6.0');
        vi.restoreAllMocks();
    });

    it('reports up to date when the fallback finds no newer GitHub release', async () => {
        checkMock.mockRejectedValue('the platform `windows-x86_64` was not found on the response `platforms` object');
        manualCheckMock.mockResolvedValue(null);
        await expect(store().checkNow({ manual: true })).resolves.toBe('up-to-date');
        expect(store()).toMatchObject({ phase: 'idle', update: null, dialogOpen: false });
    });

    it('keeps the app running and offers a retry when the signature does not verify', async () => {
        checkMock.mockResolvedValue(fakeUpdate('1.5.0', {
            downloadAndInstall: vi.fn(async () => {
                throw new Error('signature verification failed');
            }),
        }));
        await store().checkNow();
        await store().installUpdate();
        expect(store()).toMatchObject({ phase: 'error', errorKind: 'signature', errorStage: 'install', dialogOpen: true });
        expect(flushMock).not.toHaveBeenCalled();
        expect(relaunchMock).not.toHaveBeenCalled();
        expect(readAppUpdaterPrefs().pendingWhatsNew).toBeUndefined();
    });

    it('reports a relaunch failure after a successful install', async () => {
        checkMock.mockResolvedValue(fakeUpdate());
        relaunchMock.mockRejectedValueOnce(new Error('restart denied'));
        await store().checkNow();
        await store().installUpdate();
        expect(store()).toMatchObject({ phase: 'error', errorStage: 'relaunch' });
    });

    it('persists the automatic-check toggle per device', () => {
        expect(store().autoCheck).toBe(true);
        store().setAutoCheck(false);
        expect(readAppUpdaterPrefs().autoCheck).toBe(false);
        resetAppUpdaterStoreForTests();
        expect(store().autoCheck).toBe(false);
    });

    it('shows What\'s new once after relaunching on the new version', () => {
        updateAppUpdaterPrefs((prefs) => ({ ...prefs, pendingWhatsNew: { version: '1.5.0', notes: '- New' } }));

        store().loadWhatsNew('1.4.1');
        expect(store().whatsNew).toBeNull();

        store().loadWhatsNew('1.5.0');
        expect(store().whatsNew).toEqual({ version: '1.5.0', notes: '- New' });
        store().dismissWhatsNew();
        expect(store().whatsNew).toBeNull();
        expect(readAppUpdaterPrefs()).toMatchObject({ whatsNewShownVersion: '1.5.0' });

        store().loadWhatsNew('1.5.0');
        expect(store().whatsNew).toBeNull();
    });

    it('drops stale What\'s new notes once a later version is running', () => {
        updateAppUpdaterPrefs((prefs) => ({ ...prefs, pendingWhatsNew: { version: '1.5.0', notes: '- Old' } }));
        store().loadWhatsNew('1.6.0');
        expect(store().whatsNew).toBeNull();
        expect(readAppUpdaterPrefs().pendingWhatsNew).toBeUndefined();
    });
});
