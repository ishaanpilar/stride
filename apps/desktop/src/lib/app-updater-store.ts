import { create } from 'zustand';
import {
    flushPendingSave,
    recordDirectUpdateLater,
    recordDirectUpdatePrompted,
    recordDirectUpdateSkipped,
    shouldShowDirectUpdatePrompt,
} from '@stride/core';

import { logError, logInfo } from './app-log';
import {
    checkForAppUpdate,
    checkForManualAppUpdate,
    classifyUpdaterError,
    installerExitsApp,
    relaunchApp,
    type AppUpdateProgress,
    type AvailableAppUpdate,
    type PendingAppUpdate,
    type UpdaterErrorKind,
} from './app-updater';
import {
    clearStaleWhatsNew,
    isAutoUpdateCheckEnabled,
    readAppUpdaterPrefs,
    recordWhatsNewShown,
    resolveWhatsNew,
    updateAppUpdaterPrefs,
    type WhatsNewEntry,
} from './app-updater-prefs';
import { beginCloseFlush, resetCloseFlushGate } from './close-flush-gate';
import { readLocalUserPromptState, updateLocalUserPromptState } from './user-prompt-state';

export const UPDATE_RELAUNCH_FLUSH_TIMEOUT_MS = 10_000;

export type AppUpdatePhase =
    | 'idle'
    | 'checking'
    | 'available'
    | 'downloading'
    | 'installing'
    | 'restarting'
    | 'error';

export type AppUpdateErrorStage = 'check' | 'install' | 'relaunch';

export type AppUpdateCheckResult = 'available' | 'up-to-date' | 'suppressed' | 'error' | 'busy';

type AppUpdaterState = {
    phase: AppUpdatePhase;
    update: AvailableAppUpdate | null;
    progress: AppUpdateProgress | null;
    errorKind: UpdaterErrorKind | null;
    errorStage: AppUpdateErrorStage | null;
    dialogOpen: boolean;
    autoCheck: boolean;
    lastCheckedAt: string | null;
    whatsNew: WhatsNewEntry | null;
    whatsNewVersion: string | null;
    checkNow: (options?: { manual?: boolean }) => Promise<AppUpdateCheckResult>;
    installUpdate: () => Promise<void>;
    remindLater: () => void;
    skipVersion: () => void;
    setAutoCheck: (enabled: boolean) => void;
    loadWhatsNew: (currentVersion: string) => void;
    dismissWhatsNew: () => void;
};

const BUSY_PHASES: ReadonlySet<AppUpdatePhase> = new Set(['checking', 'downloading', 'installing', 'restarting']);

let pendingUpdate: PendingAppUpdate | null = null;

const readInitialPrefs = () => {
    const prefs = readAppUpdaterPrefs();
    return {
        autoCheck: isAutoUpdateCheckEnabled(prefs),
        lastCheckedAt: prefs.lastCheckedAt ?? null,
    };
};

const logUpdaterError = (error: unknown, step: string, kind: UpdaterErrorKind) => {
    void logError(error, { scope: 'updater', step, extra: { kind } });
};

const safelyUpdatePromptState = (step: string, apply: Parameters<typeof updateLocalUserPromptState>[0]) => {
    try {
        updateLocalUserPromptState(apply);
    } catch (error) {
        void logError(error, { scope: 'updater', step });
    }
};

export const useAppUpdaterStore = create<AppUpdaterState>((set, get) => ({
    phase: 'idle',
    update: null,
    progress: null,
    errorKind: null,
    errorStage: null,
    dialogOpen: false,
    whatsNew: null,
    whatsNewVersion: null,
    ...readInitialPrefs(),

    checkNow: async ({ manual = false } = {}) => {
        if (BUSY_PHASES.has(get().phase)) return 'busy';
        if (!manual && get().dialogOpen) return 'busy';
        set({ phase: 'checking', errorKind: null, errorStage: null });
        const present = (info: AvailableAppUpdate | null): AppUpdateCheckResult => {
            const nowMs = Date.now();
            const lastCheckedAt = new Date(nowMs).toISOString();
            updateAppUpdaterPrefs((prefs) => ({ ...prefs, lastCheckedAt }));
            if (!info) {
                set({ phase: 'idle', update: null, lastCheckedAt });
                return 'up-to-date';
            }
            set({ phase: 'available', update: info, lastCheckedAt });
            const shouldShow = shouldShowDirectUpdatePrompt({
                nowMs,
                promptState: readLocalUserPromptState(),
                currentVersion: info.currentVersion,
                latestVersion: info.version,
                manual,
            });
            if (!shouldShow) return 'suppressed';
            safelyUpdatePromptState('recordPrompted', (state) => recordDirectUpdatePrompted(state, info.version, nowMs));
            set({ dialogOpen: true });
            return 'available';
        };
        try {
            const result = await checkForAppUpdate();
            pendingUpdate = result;
            return present(result?.info ?? null);
        } catch (error) {
            const kind = classifyUpdaterError(error);
            logUpdaterError(error, 'check', kind);
            if (kind === 'unavailable') {
                // No signed bundle for this machine in latest.json (an Intel Mac, or a Windows
                // release built without updater signing): offer the GitHub download instead.
                try {
                    const manualUpdate = await checkForManualAppUpdate();
                    pendingUpdate = null;
                    return present(manualUpdate);
                } catch (fallbackError) {
                    logUpdaterError(fallbackError, 'check-fallback', classifyUpdaterError(fallbackError));
                }
            }
            set({ phase: 'error', errorKind: kind, errorStage: 'check' });
            return 'error';
        }
    },

    installUpdate: async () => {
        const target = pendingUpdate;
        if (!target || BUSY_PHASES.has(get().phase)) return;
        const { info } = target;
        set({
            phase: 'downloading',
            progress: { downloadedBytes: 0, totalBytes: null },
            errorKind: null,
            errorStage: null,
            dialogOpen: true,
        });
        const flushBeforeExit = () => beginCloseFlush({
            flush: flushPendingSave,
            timeoutMs: UPDATE_RELAUNCH_FLUSH_TIMEOUT_MS,
            logStep: (step) => {
                void logInfo(`Update relaunch: ${step}`, { scope: 'updater', force: true });
            },
            reportError: (label, error) => {
                void logError(error, { scope: 'updater', step: label });
            },
        });
        // Windows: the installer closes Stride as soon as it starts, so save and record "What's
        // new" before handing over; the installer relaunches the new version itself.
        const beforeInstall = installerExitsApp()
            ? async () => {
                updateAppUpdaterPrefs((prefs) => ({
                    ...prefs,
                    pendingWhatsNew: { version: info.version, notes: info.notes },
                }));
                set({ phase: 'restarting' });
                await flushBeforeExit();
            }
            : undefined;
        try {
            await target.downloadAndInstall((progress) => {
                const finished = progress.totalBytes !== null && progress.downloadedBytes >= progress.totalBytes;
                set({ progress, phase: finished ? 'installing' : 'downloading' });
            }, beforeInstall ? { beforeInstall } : undefined);
        } catch (error) {
            if (beforeInstall) {
                resetCloseFlushGate();
                updateAppUpdaterPrefs((prefs) => {
                    const next = { ...prefs };
                    delete next.pendingWhatsNew;
                    return next;
                });
            }
            const kind = classifyUpdaterError(error);
            logUpdaterError(error, 'install', kind);
            set({ phase: 'error', errorKind: kind, errorStage: 'install' });
            return;
        }
        updateAppUpdaterPrefs((prefs) => ({
            ...prefs,
            pendingWhatsNew: { version: info.version, notes: info.notes },
        }));
        set({ phase: 'restarting' });
        try {
            await flushBeforeExit();
            await relaunchApp();
        } catch (error) {
            resetCloseFlushGate();
            logUpdaterError(error, 'relaunch', 'unknown');
            set({ phase: 'error', errorKind: 'unknown', errorStage: 'relaunch' });
        }
    },

    remindLater: () => {
        const { update, phase } = get();
        if (phase === 'downloading' || phase === 'installing' || phase === 'restarting') return;
        if (update) {
            safelyUpdatePromptState('recordLater', (state) => recordDirectUpdateLater(state, update.version, Date.now()));
        }
        set({
            dialogOpen: false,
            phase: update && phase !== 'error' ? 'available' : phase,
        });
    },

    skipVersion: () => {
        const { update, phase } = get();
        if (phase === 'downloading' || phase === 'installing' || phase === 'restarting') return;
        if (update) {
            safelyUpdatePromptState('recordSkipped', (state) => recordDirectUpdateSkipped(state, update.version));
        }
        set({ dialogOpen: false });
    },

    setAutoCheck: (enabled) => {
        updateAppUpdaterPrefs((prefs) => ({ ...prefs, autoCheck: enabled }));
        set({ autoCheck: enabled });
    },

    loadWhatsNew: (currentVersion) => {
        const prefs = updateAppUpdaterPrefs((current) => clearStaleWhatsNew(current, currentVersion));
        set({ whatsNew: resolveWhatsNew(prefs, currentVersion), whatsNewVersion: currentVersion });
    },

    dismissWhatsNew: () => {
        const { whatsNewVersion } = get();
        if (whatsNewVersion) {
            updateAppUpdaterPrefs((prefs) => recordWhatsNewShown(prefs, whatsNewVersion));
        }
        set({ whatsNew: null });
    },
}));

export function resetAppUpdaterStoreForTests(): void {
    pendingUpdate = null;
    useAppUpdaterStore.setState({
        phase: 'idle',
        update: null,
        progress: null,
        errorKind: null,
        errorStage: null,
        dialogOpen: false,
        whatsNew: null,
        whatsNewVersion: null,
        ...readInitialPrefs(),
    });
}
