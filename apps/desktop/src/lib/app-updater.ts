import type { DownloadEvent } from '@tauri-apps/plugin-updater';

import { isTauriRuntime } from './runtime';
import { checkForUpdates, detectPlatform, type InstallSource } from './update-service';

export const IN_APP_UPDATE_INSTALL_SOURCES: ReadonlySet<InstallSource> = new Set<InstallSource>([
    'direct',
    'github-release',
]);

/**
 * Platforms whose GitHub installs use the Tauri updater. macOS (Apple silicon) and Windows x64 are
 * published in `latest.json`; when the manifest has no entry for this machine (an Intel Mac, or a
 * Windows release built without updater signing) the check falls back to the GitHub release and
 * offers a manual download instead.
 */
export const IN_APP_UPDATE_PLATFORMS: ReadonlySet<string> = new Set(['macos', 'windows']);

export const GITHUB_RELEASE_DOWNLOAD_URL = 'https://github.com/ishaanpilar/stride/releases/latest';

export const UPDATER_CHECK_TIMEOUT_MS = 30_000;

export type AvailableAppUpdate = {
    version: string;
    currentVersion: string;
    notes: string;
    date: string | null;
    /** No signed in-app bundle for this machine: the dialog links to GitHub instead of installing. */
    downloadOnly?: boolean;
    /** Where "Download from GitHub" goes for a download-only update. */
    downloadUrl?: string;
};

export type AppUpdateProgress = {
    downloadedBytes: number;
    totalBytes: number | null;
};

export type PendingAppUpdate = {
    info: AvailableAppUpdate;
    /**
     * `beforeInstall` runs between download and install. Windows needs it: the NSIS installer
     * closes Stride as soon as it starts, so pending changes must be saved before that.
     */
    downloadAndInstall: (
        onProgress: (progress: AppUpdateProgress) => void,
        options?: { beforeInstall?: () => Promise<void> },
    ) => Promise<void>;
};

/** The Windows installer exits the app the moment it starts, so saves happen before install. */
export const installerExitsApp = (platform: string = detectPlatform()): boolean => platform === 'windows';

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
        downloadAndInstall: async (onProgress, options) => {
            let downloadedBytes = 0;
            let totalBytes: number | null = null;
            const onEvent = (event: DownloadEvent) => {
                if (event.event === 'Started') {
                    totalBytes = event.data.contentLength ?? null;
                } else if (event.event === 'Progress') {
                    downloadedBytes += event.data.chunkLength;
                } else {
                    downloadedBytes = totalBytes ?? downloadedBytes;
                }
                onProgress({ downloadedBytes, totalBytes });
            };
            if (!options?.beforeInstall) {
                await update.downloadAndInstall(onEvent);
                return;
            }
            await update.download(onEvent);
            await options.beforeInstall();
            await update.install();
        },
    };
}

/**
 * Fallback for a check that found no in-app update for this platform: ask GitHub for the latest
 * release. Returns a download-only update when it is newer, null when this copy is current.
 */
export async function checkForManualAppUpdate(): Promise<AvailableAppUpdate | null> {
    if (!isTauriRuntime()) return null;
    const { getVersion } = await import('@tauri-apps/api/app');
    const currentVersion = await getVersion();
    const info = await checkForUpdates(currentVersion, { installSource: 'github-release' });
    if (!info.hasUpdate) return null;
    return {
        version: info.latestVersion,
        currentVersion,
        notes: info.releaseNotes ?? '',
        date: info.latestReleasedAt,
        downloadOnly: true,
        downloadUrl: info.releaseUrl || GITHUB_RELEASE_DOWNLOAD_URL,
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
