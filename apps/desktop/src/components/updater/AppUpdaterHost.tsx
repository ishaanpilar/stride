import { useCallback, useEffect } from 'react';
import { DIRECT_UPDATE_CHECK_INTERVAL_MS, DIRECT_UPDATE_FIRST_CHECK_DELAY_MS } from '@stride/core';

import { logError } from '../../lib/app-log';
import { supportsInAppUpdates } from '../../lib/app-updater';
import { useAppUpdaterStore } from '../../lib/app-updater-store';
import { openExternalLink } from '../../lib/external-link';
import { isTauriRuntime } from '../../lib/runtime';
import type { InstallSource } from '../../lib/update-service';
import { AppUpdateDialog } from './AppUpdateDialog';
import { WhatsNewDialog } from './WhatsNewDialog';

type AppUpdaterHostProps = {
    enabled: boolean;
    installSource: InstallSource | null;
    blocked?: boolean;
    firstCheckDelayMs?: number;
    checkIntervalMs?: number;
};

export function AppUpdaterHost({
    enabled,
    installSource,
    blocked = false,
    firstCheckDelayMs = DIRECT_UPDATE_FIRST_CHECK_DELAY_MS,
    checkIntervalMs = DIRECT_UPDATE_CHECK_INTERVAL_MS,
}: AppUpdaterHostProps) {
    const autoCheck = useAppUpdaterStore((state) => state.autoCheck);
    const inAppUpdates = enabled && supportsInAppUpdates(installSource);

    useEffect(() => {
        if (!enabled || !isTauriRuntime()) return;
        let cancelled = false;
        (async () => {
            try {
                const { getVersion } = await import('@tauri-apps/api/app');
                const currentVersion = await getVersion();
                if (!cancelled) useAppUpdaterStore.getState().loadWhatsNew(currentVersion);
            } catch (error) {
                void logError(error, { scope: 'updater', step: 'loadWhatsNew' });
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [enabled]);

    useEffect(() => {
        if (!inAppUpdates || !autoCheck) return;
        const runCheck = () => {
            void useAppUpdaterStore.getState().checkNow({ manual: false });
        };
        const firstTimer = window.setTimeout(runCheck, firstCheckDelayMs);
        const interval = window.setInterval(runCheck, checkIntervalMs);
        return () => {
            window.clearTimeout(firstTimer);
            window.clearInterval(interval);
        };
    }, [autoCheck, checkIntervalMs, firstCheckDelayMs, inAppUpdates]);

    const openDownloadPage = useCallback((url: string) => {
        openExternalLink(url, 'markdown').catch((error) => {
            void logError(error, { scope: 'updater', step: 'openDownloadPage' });
        });
    }, []);

    if (!enabled) return null;

    return (
        <>
            <AppUpdateDialog blocked={blocked} onOpenDownloadPage={openDownloadPage} />
            <WhatsNewDialog blocked={blocked} />
        </>
    );
}
