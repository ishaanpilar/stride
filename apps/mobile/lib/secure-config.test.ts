import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CLOUD_TOKEN_KEY, WEBDAV_PASSWORD_KEY } from './sync-constants';

const storeMocks = vi.hoisted(() => ({
    secureAvailable: true,
    availabilityFailuresRemaining: 0,
    secureItems: new Map<string, string>(),
    asyncItems: new Map<string, string>(),
    failSecureWrites: false,
    isAvailableAsync: vi.fn(),
    setItemAsync: vi.fn(),
}));

vi.mock('expo-secure-store', () => ({
    isAvailableAsync: storeMocks.isAvailableAsync.mockImplementation(async () => {
        if (storeMocks.availabilityFailuresRemaining > 0) {
            storeMocks.availabilityFailuresRemaining -= 1;
            throw new Error('keystore probe failed');
        }
        return storeMocks.secureAvailable;
    }),
    getItemAsync: vi.fn(async (key: string) => storeMocks.secureItems.get(key) ?? null),
    setItemAsync: storeMocks.setItemAsync.mockImplementation(async (key: string, value: string) => {
        if (storeMocks.failSecureWrites) throw new Error('keystore unavailable');
        storeMocks.secureItems.set(key, value);
    }),
    deleteItemAsync: vi.fn(async (key: string) => {
        storeMocks.secureItems.delete(key);
    }),
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'afterFirstUnlockThisDeviceOnly',
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'whenUnlockedThisDeviceOnly',
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: vi.fn(async (key: string) => storeMocks.asyncItems.get(key) ?? null),
        setItem: vi.fn(async (key: string, value: string) => {
            storeMocks.asyncItems.set(key, value);
        }),
        removeItem: vi.fn(async (key: string) => {
            storeMocks.asyncItems.delete(key);
        }),
    },
}));

describe('secure-config', () => {
    beforeEach(() => {
        vi.resetModules();
        storeMocks.secureAvailable = true;
        storeMocks.availabilityFailuresRemaining = 0;
        storeMocks.secureItems.clear();
        storeMocks.asyncItems.clear();
        storeMocks.failSecureWrites = false;
        vi.clearAllMocks();
    });

    it('flags only the cloud token and WebDAV password as secrets', async () => {
        const { isSecretConfigKey } = await import('./secure-config');

        expect(isSecretConfigKey(CLOUD_TOKEN_KEY)).toBe(true);
        expect(isSecretConfigKey(WEBDAV_PASSWORD_KEY)).toBe(true);
        expect(isSecretConfigKey('@mindwtr_cloud_url')).toBe(false);
    });

    it('writes secrets to the secure store and scrubs the plaintext copy', async () => {
        const { setSecureConfigValue } = await import('./secure-config');
        storeMocks.asyncItems.set(CLOUD_TOKEN_KEY, 'old-plaintext');

        await setSecureConfigValue(CLOUD_TOKEN_KEY, 'fresh-token');

        expect(storeMocks.secureItems.get('mindwtr_cloud_token')).toBe('fresh-token');
        expect(storeMocks.asyncItems.has(CLOUD_TOKEN_KEY)).toBe(false);
        expect(storeMocks.setItemAsync).toHaveBeenCalledWith(
            'mindwtr_cloud_token',
            'fresh-token',
            { keychainAccessible: 'afterFirstUnlockThisDeviceOnly' },
        );
    });

    it('reads from the secure store first', async () => {
        const { getSecureConfigValue } = await import('./secure-config');
        storeMocks.secureItems.set('mindwtr_webdav_password', 'secure-pass');
        storeMocks.asyncItems.set(WEBDAV_PASSWORD_KEY, 'stale-plaintext');

        await expect(getSecureConfigValue(WEBDAV_PASSWORD_KEY)).resolves.toBe('secure-pass');
        expect(storeMocks.asyncItems.has(WEBDAV_PASSWORD_KEY)).toBe(false);
    });

    it('migrates a legacy plaintext value into the secure store on read', async () => {
        const { getSecureConfigValue } = await import('./secure-config');
        storeMocks.asyncItems.set(CLOUD_TOKEN_KEY, 'legacy-token');

        await expect(getSecureConfigValue(CLOUD_TOKEN_KEY)).resolves.toBe('legacy-token');
        expect(storeMocks.secureItems.get('mindwtr_cloud_token')).toBe('legacy-token');
        expect(storeMocks.asyncItems.has(CLOUD_TOKEN_KEY)).toBe(false);
    });

    it('fails closed and keeps the legacy copy when secure migration transiently fails', async () => {
        const { getSecureConfigValue } = await import('./secure-config');
        storeMocks.asyncItems.set(CLOUD_TOKEN_KEY, 'legacy-token');
        storeMocks.failSecureWrites = true;

        await expect(getSecureConfigValue(CLOUD_TOKEN_KEY)).rejects.toThrow('keystore unavailable');
        expect(storeMocks.asyncItems.get(CLOUD_TOKEN_KEY)).toBe('legacy-token');
    });

    it('retries a transient availability failure without writing plaintext', async () => {
        const { setSecureConfigValue } = await import('./secure-config');
        storeMocks.availabilityFailuresRemaining = 1;

        await expect(setSecureConfigValue(CLOUD_TOKEN_KEY, 'fresh-token')).rejects.toThrow(
            'keystore probe failed',
        );
        expect(storeMocks.asyncItems.has(CLOUD_TOKEN_KEY)).toBe(false);

        await expect(setSecureConfigValue(CLOUD_TOKEN_KEY, 'fresh-token')).resolves.toBeUndefined();
        expect(storeMocks.isAvailableAsync).toHaveBeenCalledTimes(2);
        expect(storeMocks.secureItems.get('mindwtr_cloud_token')).toBe('fresh-token');
    });

    it('keeps new secrets in memory only when secure storage is unsupported', async () => {
        const { getSecureConfigValue, setSecureConfigValue } = await import('./secure-config');
        storeMocks.secureAvailable = false;

        await setSecureConfigValue(CLOUD_TOKEN_KEY, 'session-token');

        expect(storeMocks.asyncItems.has(CLOUD_TOKEN_KEY)).toBe(false);
        expect(storeMocks.secureItems.has('mindwtr_cloud_token')).toBe(false);
        await expect(getSecureConfigValue(CLOUD_TOKEN_KEY)).resolves.toBe('session-token');
    });

    it('evacuates legacy plaintext into memory when secure storage is unsupported', async () => {
        const { getSecureConfigValue } = await import('./secure-config');
        storeMocks.secureAvailable = false;
        storeMocks.asyncItems.set(CLOUD_TOKEN_KEY, 'legacy-session-token');

        await expect(getSecureConfigValue(CLOUD_TOKEN_KEY)).resolves.toBe('legacy-session-token');
        expect(storeMocks.asyncItems.has(CLOUD_TOKEN_KEY)).toBe(false);
        await expect(getSecureConfigValue(CLOUD_TOKEN_KEY)).resolves.toBe('legacy-session-token');
    });

    it('returns null when neither store has a value', async () => {
        const { getSecureConfigValue } = await import('./secure-config');
        await expect(getSecureConfigValue(WEBDAV_PASSWORD_KEY)).resolves.toBeNull();
    });

    it('deletes from both stores', async () => {
        const { deleteSecureConfigValue } = await import('./secure-config');
        storeMocks.secureItems.set('mindwtr_webdav_password', 'secure-pass');
        storeMocks.asyncItems.set(WEBDAV_PASSWORD_KEY, 'stale-plaintext');

        await deleteSecureConfigValue(WEBDAV_PASSWORD_KEY);

        expect(storeMocks.secureItems.has('mindwtr_webdav_password')).toBe(false);
        expect(storeMocks.asyncItems.has(WEBDAV_PASSWORD_KEY)).toBe(false);
    });
});
