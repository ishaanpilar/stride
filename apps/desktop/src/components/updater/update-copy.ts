import { resolveI18nText, type I18nTemplateValues } from '@stride/core';

import { formatUpdateBytes, type AppUpdateProgress, type UpdaterErrorKind } from '../../lib/app-updater';
import type { AppUpdateErrorStage } from '../../lib/app-updater-store';

type Translate = (key: string) => string;

export const updaterText = (t: Translate, key: string, values?: I18nTemplateValues): string => (
    resolveI18nText(t, `updater.${key}`, values ? { values } : undefined)
);

const ERROR_KEYS: Record<UpdaterErrorKind, string> = {
    offline: 'error.offline',
    signature: 'error.signature',
    'rate-limited': 'error.rateLimited',
    unavailable: 'error.unavailable',
    unknown: 'error.unknown',
};

export function describeUpdaterError(
    t: Translate,
    kind: UpdaterErrorKind | null,
    stage: AppUpdateErrorStage | null,
): string {
    if (stage === 'relaunch') return updaterText(t, 'error.relaunch');
    return updaterText(t, ERROR_KEYS[kind ?? 'unknown']);
}

export function describeUpdateProgress(t: Translate, progress: AppUpdateProgress | null): string {
    if (!progress || progress.totalBytes === null || progress.totalBytes <= 0) {
        return updaterText(t, 'downloadingUnknown');
    }
    return updaterText(t, 'downloading', {
        downloaded: formatUpdateBytes(progress.downloadedBytes),
        total: formatUpdateBytes(progress.totalBytes),
    });
}
