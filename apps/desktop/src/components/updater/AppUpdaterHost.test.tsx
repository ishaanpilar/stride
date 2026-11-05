import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const checkMock = vi.hoisted(() => vi.fn());
const relaunchMock = vi.hoisted(() => vi.fn(async () => undefined));
const flushMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('@tauri-apps/plugin-updater', () => ({ check: checkMock }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: relaunchMock }));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn(async () => '1.5.0') }));
vi.mock('@stride/core', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@stride/core')>()),
    flushPendingSave: flushMock,
}));
vi.mock('../../lib/app-log', () => ({
    logError: vi.fn(async () => null),
    logInfo: vi.fn(async () => null),
}));

import { LanguageProvider } from '../../contexts/language-context';
import { updateAppUpdaterPrefs } from '../../lib/app-updater-prefs';
import { resetAppUpdaterStoreForTests, useAppUpdaterStore } from '../../lib/app-updater-store';
import { resetCloseFlushGate } from '../../lib/close-flush-gate';
import type { InstallSource } from '../../lib/update-service';
import { AppUpdaterHost } from './AppUpdaterHost';

const MAC_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)';
const FIRST_DELAY = 30_000;
const INTERVAL = 6 * 60 * 60 * 1000;

function fakeUpdate() {
    return {
        version: '1.5.0',
        currentVersion: '1.4.1',
        body: "## What's new\n- **Calendar** time-blocking\n- Faster 'Inbox' sync",
        date: '2026-11-05T08:00:00Z',
        downloadAndInstall: vi.fn(async (onEvent: (event: unknown) => void) => {
            onEvent({ event: 'Started', data: { contentLength: 2048 } });
            onEvent({ event: 'Progress', data: { chunkLength: 2048 } });
            onEvent({ event: 'Finished' });
        }),
    };
}

function renderHost(installSource: InstallSource | null = 'direct', blocked = false) {
    return render(
        <LanguageProvider>
            <AppUpdaterHost enabled installSource={installSource} blocked={blocked} />
        </LanguageProvider>,
    );
}

async function advance(ms: number) {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
    });
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-05T09:00:00.000Z'));
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(MAC_USER_AGENT);
    (window as unknown as { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__ = {};
    window.localStorage.clear();
    checkMock.mockReset();
    relaunchMock.mockClear();
    flushMock.mockClear();
    resetCloseFlushGate();
    resetAppUpdaterStoreForTests();
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (window as unknown as { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__;
});

describe('AppUpdaterHost', () => {
    it('checks 30s after launch, shows the dialog with markdown notes, installs and relaunches', async () => {
        checkMock.mockResolvedValue(fakeUpdate());
        renderHost();

        await advance(FIRST_DELAY - 1);
        expect(checkMock).not.toHaveBeenCalled();
        await advance(1);
        expect(checkMock).toHaveBeenCalledTimes(1);

        expect(screen.getByRole('heading', { name: 'Stride 1.5.0 is available' })).toBeInTheDocument();
        const notes = screen.getByTestId('app-update-notes');
        expect(notes.querySelector('strong')?.textContent).toBe('Calendar');
        expect(notes.querySelector('li')).not.toBeNull();
        expect(notes.textContent).toContain("Faster 'Inbox' sync");
        expect(screen.getByRole('button', { name: 'Later' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Skip this version' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Install and restart' }));
        await advance(0);
        expect(flushMock).toHaveBeenCalledTimes(1);
        expect(relaunchMock).toHaveBeenCalledTimes(1);
    });

    it('checks again every 6 hours while running', async () => {
        checkMock.mockResolvedValue(null);
        renderHost();
        await advance(FIRST_DELAY);
        await advance(INTERVAL);
        await advance(INTERVAL);
        expect(checkMock).toHaveBeenCalledTimes(3);
    });

    it('does not check automatically when the toggle is off', async () => {
        useAppUpdaterStore.getState().setAutoCheck(false);
        renderHost();
        await advance(FIRST_DELAY + INTERVAL);
        expect(checkMock).not.toHaveBeenCalled();
    });

    it.each<InstallSource>(['mac-app-store', 'homebrew', 'microsoft-store', 'winget'])(
        'leaves %s installs on their existing update path',
        async (source) => {
            renderHost(source);
            await advance(FIRST_DELAY + INTERVAL);
            expect(checkMock).not.toHaveBeenCalled();
        },
    );

    it('hides the dialog while another prompt blocks it', async () => {
        checkMock.mockResolvedValue(fakeUpdate());
        renderHost('direct', true);
        await advance(FIRST_DELAY);
        expect(useAppUpdaterStore.getState().dialogOpen).toBe(true);
        expect(screen.queryByRole('heading', { name: 'Stride 1.5.0 is available' })).toBeNull();
    });

    it('closes on Later and offers a GitHub fallback when the download cannot be verified', async () => {
        const update = fakeUpdate();
        update.downloadAndInstall = vi.fn(async () => {
            throw new Error('signature verification failed');
        });
        checkMock.mockResolvedValue(update);
        renderHost();
        await advance(FIRST_DELAY);

        fireEvent.click(screen.getByRole('button', { name: 'Install and restart' }));
        await advance(0);
        expect(screen.getByRole('alert')).toHaveTextContent("This update couldn't be verified");
        expect(screen.getByRole('button', { name: 'Download from GitHub' })).toBeInTheDocument();
        expect(relaunchMock).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Later' }));
        expect(screen.queryByRole('heading', { name: 'Stride 1.5.0 is available' })).toBeNull();
    });

    it("shows What's new once after relaunching on the new version", async () => {
        updateAppUpdaterPrefs((prefs) => ({ ...prefs, pendingWhatsNew: { version: '1.5.0', notes: '- Time-blocking' } }));
        const { unmount } = renderHost();
        await advance(0);
        expect(screen.getByRole('heading', { name: "What's new in Stride 1.5.0" })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
        expect(screen.queryByRole('heading', { name: "What's new in Stride 1.5.0" })).toBeNull();
        unmount();

        renderHost();
        await advance(0);
        expect(screen.queryByRole('heading', { name: "What's new in Stride 1.5.0" })).toBeNull();
    });
});
