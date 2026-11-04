import { describe, expect, it, vi } from 'vitest';
import { canDesktopAutoSync } from './desktop-auto-sync-eligibility';

const createSyncService = (overrides: Partial<Parameters<typeof canDesktopAutoSync>[0]> = {}) => ({
    getPersistedSyncConfigurationSnapshot: vi.fn(async () => ({
        backend: 'off' as const,
        syncPath: '',
        webdav: { url: '' },
        cloud: { url: '' },
        cloudProvider: 'selfhosted' as const,
    })),
    getDropboxAppKey: vi.fn(async () => ''),
    isDropboxConnected: vi.fn(async () => false),
    ...overrides,
});

describe('canDesktopAutoSync', () => {
    it('allows CloudKit autosync on desktop when the backend is enabled', async () => {
        const syncService = createSyncService({
            getPersistedSyncConfigurationSnapshot: vi.fn(async () => ({
                backend: 'cloudkit' as const,
                syncPath: '',
                webdav: { url: '' },
                cloud: { url: '' },
                cloudProvider: 'selfhosted' as const,
            })),
        });

        await expect(canDesktopAutoSync(syncService)).resolves.toBe(true);
        expect(syncService.getPersistedSyncConfigurationSnapshot).toHaveBeenCalledTimes(1);
        expect(syncService.getDropboxAppKey).not.toHaveBeenCalled();
        expect(syncService.isDropboxConnected).not.toHaveBeenCalled();
    });

    it('allows self-hosted cloud autosync when the URL is configured', async () => {
        const syncService = createSyncService({
            getPersistedSyncConfigurationSnapshot: vi.fn(async () => ({
                backend: 'cloud' as const,
                syncPath: '',
                webdav: { url: '' },
                cloud: { url: 'https://sync.example.com' },
                cloudProvider: 'selfhosted' as const,
            })),
        });

        await expect(canDesktopAutoSync(syncService)).resolves.toBe(true);
        expect(syncService.getPersistedSyncConfigurationSnapshot).toHaveBeenCalledTimes(1);
        expect(syncService.isDropboxConnected).not.toHaveBeenCalled();
    });

    it('allows Dropbox autosync when an app key is configured and connected', async () => {
        const syncService = createSyncService({
            getPersistedSyncConfigurationSnapshot: vi.fn(async () => ({
                backend: 'cloud' as const,
                syncPath: '',
                webdav: { url: '' },
                cloud: { url: '' },
                cloudProvider: 'dropbox' as const,
            })),
            getDropboxAppKey: vi.fn(async () => 'dropbox-app-key'),
            isDropboxConnected: vi.fn(async () => true),
        });

        await expect(canDesktopAutoSync(syncService)).resolves.toBe(true);
        expect(syncService.getDropboxAppKey).toHaveBeenCalledTimes(1);
        expect(syncService.isDropboxConnected).toHaveBeenCalledWith('dropbox-app-key');
    });

    it('disables Dropbox autosync when the app key is missing or disconnected', async () => {
        const missingKeyService = createSyncService({
            getPersistedSyncConfigurationSnapshot: vi.fn(async () => ({
                backend: 'cloud' as const,
                syncPath: '',
                webdav: { url: '' },
                cloud: { url: '' },
                cloudProvider: 'dropbox' as const,
            })),
            getDropboxAppKey: vi.fn(async () => '   '),
        });
        const disconnectedService = createSyncService({
            getPersistedSyncConfigurationSnapshot: vi.fn(async () => ({
                backend: 'cloud' as const,
                syncPath: '',
                webdav: { url: '' },
                cloud: { url: '' },
                cloudProvider: 'dropbox' as const,
            })),
            getDropboxAppKey: vi.fn(async () => 'dropbox-app-key'),
            isDropboxConnected: vi.fn(async () => false),
        });

        await expect(canDesktopAutoSync(missingKeyService)).resolves.toBe(false);
        await expect(canDesktopAutoSync(disconnectedService)).resolves.toBe(false);
        expect(disconnectedService.isDropboxConnected).toHaveBeenCalledWith('dropbox-app-key');
    });
});
