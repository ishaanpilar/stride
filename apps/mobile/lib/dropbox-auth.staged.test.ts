import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    forceRefreshDropboxAccessTokenForTokens,
    getValidDropboxAccessTokenForTokens,
    revokeDropboxTokens,
} from './dropbox-auth';

const mocks = vi.hoisted(() => ({
    deleteItemAsync: vi.fn(),
    getItem: vi.fn(),
    getItemAsync: vi.fn(),
    removeItem: vi.fn(),
    setItem: vi.fn(),
    setItemAsync: vi.fn(),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: mocks.getItem,
        removeItem: mocks.removeItem,
        setItem: mocks.setItem,
    },
}));

vi.mock('expo-secure-store', () => ({
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
    deleteItemAsync: mocks.deleteItemAsync,
    getItemAsync: mocks.getItemAsync,
    isAvailableAsync: vi.fn().mockResolvedValue(false),
    setItemAsync: mocks.setItemAsync,
}));

describe('staged Dropbox credentials', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('refreshes an explicit bundle without writing durable credential storage', async () => {
        const fetcher = vi.fn(async () => new Response(JSON.stringify({
            access_token: 'refreshed-access',
            expires_in: 14_400,
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));

        const resolution = await forceRefreshDropboxAccessTokenForTokens(
            'dropbox-app-key',
            {
                accessToken: 'candidate-access',
                refreshToken: 'candidate-refresh',
                expiresAt: 1,
            },
            fetcher,
        );

        expect(resolution.accessToken).toBe('refreshed-access');
        expect(resolution.tokens).toMatchObject({
            accessToken: 'refreshed-access',
            refreshToken: 'candidate-refresh',
        });
        expect(fetcher).toHaveBeenCalledWith(
            'https://api.dropboxapi.com/oauth2/token',
            expect.objectContaining({
                body: expect.stringContaining('refresh_token=candidate-refresh'),
                method: 'POST',
            }),
        );
        expect(mocks.setItem).not.toHaveBeenCalled();
        expect(mocks.setItemAsync).not.toHaveBeenCalled();
        expect(mocks.removeItem).not.toHaveBeenCalled();
    });

    it('uses a valid explicit bundle without reading or writing durable storage', async () => {
        const fetcher = vi.fn();
        const tokens = {
            accessToken: 'candidate-access',
            refreshToken: 'candidate-refresh',
            expiresAt: Date.now() + 3_600_000,
        };

        const resolution = await getValidDropboxAccessTokenForTokens(
            'dropbox-app-key',
            tokens,
            fetcher,
        );

        expect(resolution).toEqual({ accessToken: 'candidate-access', tokens });
        expect(fetcher).not.toHaveBeenCalled();
        expect(mocks.getItem).not.toHaveBeenCalled();
        expect(mocks.getItemAsync).not.toHaveBeenCalled();
        expect(mocks.setItem).not.toHaveBeenCalled();
        expect(mocks.setItemAsync).not.toHaveBeenCalled();
    });

    it('revokes an explicit bundle without clearing durable credentials', async () => {
        const fetcher = vi.fn(async () => new Response(null, { status: 200 }));
        await revokeDropboxTokens('dropbox-app-key', {
            accessToken: 'candidate-access',
            refreshToken: 'candidate-refresh',
            expiresAt: Date.now() + 3_600_000,
        }, fetcher);

        expect(fetcher).toHaveBeenCalledWith(
            'https://api.dropboxapi.com/2/auth/token/revoke',
            expect.objectContaining({
                headers: { Authorization: 'Bearer candidate-access' },
                method: 'POST',
            }),
        );
        expect(mocks.removeItem).not.toHaveBeenCalled();
        expect(mocks.deleteItemAsync).not.toHaveBeenCalled();
    });
});
