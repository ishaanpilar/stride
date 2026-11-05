import type { DownloadEvent } from '@tauri-apps/plugin-updater';

import { isTauriRuntime } from './runtime';
import { detectPlatform, type InstallSource } from './update-service';

export const IN_APP_UPDATE_INSTALL_SOURCES: ReadonlySet<InstallSource> = new Set<InstallSource>([
    'direct',
    'github-release',
]);

export const IN_APP_UPDATE_PLATFORMS: ReadonlySet<string> = new Set(['macos']);

export const GITHUB_RELEASE_DOWNLOAD_URL = 'https://github.com/ishaanpilar/stride/releases/latest';

export const UPDATER_CHECK_TIMEOUT_MS = 30_000;

export type AvailableAppUpdate = {
    version: string;
    currentVersion: string;
    notes: string;
    date: string | null;
};

export type AppUpdateProgress = {
    downloadedBytes: number;
    totalBytes: number | null;
};

export type PendingAppUpdate = {
    info: AvailableAppUpdate;
    downloadAndInstall: (onProgress: (progress: AppUpdateProgress) => void) => Promise<void>;
};

export type UpdaterErrorKind = 'offline' | 'signature' | 'rate-limited' | 'unavailable' | 'unknown';

export function supportsInAppUpdates(
    installSource: InstallSource | null | undefined,
    platform: string = detectPlatform(),
): boolean {
    return Boolean(installSource)
        && IN_APP_UPDATE_INSTALL_SOURCES.has(installSource as InstallSource)
        && IN_APP_UPDATE_PLATFORMS.has(platform);
}

export async function checkForAppUpdate(): Promise<PendingAppUpdate | null> {
    if (!isTauriRuntime()) return null;
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check({ timeout: UPDATER_CHECK_TIMEOUT_MS });
    if (!update) return null;
    return {
        info: {
            version: update.version,
            currentVersion: update.currentVersion,
            notes: update.body ?? '',
            date: update.date ?? null,
        },
        downloadAndInstall: async (onProgress) => {
            let downloadedBytes = 0;
            let totalBytes: number | null = null;
            await update.downloadAndInstall((event: DownloadEvent) => {
                if (event.event === 'Started') {
                    totalBytes = event.data.contentLength ?? null;
                } else if (event.event === 'Progress') {
                    downloadedBytes += event.data.chunkLength;
                } else {
                    downloadedBytes = totalBytes ?? downloadedBytes;
                }
                onProgress({ downloadedBytes, totalBytes });
            });
        },
    };
}

export async function relaunchApp(): Promise<void> {
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
}

const SIGNATURE_PATTERN = /signature|minisign|public key|pubkey/;
const RATE_LIMIT_PATTERN = /rate.?limit|\b403\b|\b429\b/;
const UNAVAILABLE_PATTERN = /valid release json|platform .*not found|\b404\b|no endpoints/;
const OFFLINE_PATTERN = /network|offline|dns|timed? ?out|connect|unreachable|error sending request|failed to fetch/;

export function classifyUpdaterError(error: unknown): UpdaterErrorKind {
    const message = (error instanceof Error ? error.message : String(error ?? '')).toLowerCase();
    if (SIGNATURE_PATTERN.test(message)) return 'signature';
    if (RATE_LIMIT_PATTERN.test(message)) return 'rate-limited';
    if (UNAVAILABLE_PATTERN.test(message)) return 'unavailable';
    if (OFFLINE_PATTERN.test(message)) return 'offline';
    return 'unknown';
}

export function formatUpdateBytes(bytes: number): string {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${bytes} B`;
}

export function toReleaseNotesMarkdown(notes: string): string {
    return notes
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[([^\]]+)\]\((?:[^)]*)\)/g, '$1')
        .replace(/<[^>]+>/g, '')
        .trim();
}
