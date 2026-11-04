import { canAutoSync, type SyncBackend } from '@stride/core';
import type { CloudProvider } from './sync-service';

type SyncServiceLike = {
    getPersistedSyncConfigurationSnapshot: () => Promise<{
        backend: SyncBackend;
        syncPath: string;
        webdav: { url: string };
        cloud: { url: string };
        cloudProvider: CloudProvider;
    }>;
    getDropboxAppKey: () => Promise<string>;
    isDropboxConnected: (clientId: string) => Promise<boolean>;
};

export async function canDesktopAutoSync(syncService: SyncServiceLike): Promise<boolean> {
    const configuration = await syncService.getPersistedSyncConfigurationSnapshot();
    const { backend } = configuration;
    const filePath = backend === 'file' ? configuration.syncPath : undefined;
    const webdavUrl = backend === 'webdav' ? configuration.webdav.url : undefined;
    const cloudProvider = backend === 'cloud' ? configuration.cloudProvider : undefined;
    const dropboxAppKey = backend === 'cloud' && cloudProvider === 'dropbox'
        ? (await syncService.getDropboxAppKey()).trim()
        : undefined;
    const isDropboxConnected = backend === 'cloud' && cloudProvider === 'dropbox' && dropboxAppKey
        ? await syncService.isDropboxConnected(dropboxAppKey)
        : undefined;
    const cloudUrl = backend === 'cloud' && cloudProvider !== 'dropbox'
        ? configuration.cloud.url
        : undefined;

    return canAutoSync({
        backend,
        filePath,
        webdavUrl,
        cloudProvider,
        dropboxAppKey,
        isDropboxConnected,
        cloudUrl,
    });
}
