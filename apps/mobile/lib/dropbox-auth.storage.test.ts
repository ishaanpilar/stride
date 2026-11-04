import { beforeEach, describe, expect, it, vi } from 'vitest';

const storeMocks = vi.hoisted(() => ({
    secureAvailable: true,
    availabilityFailuresRemaining: 0,
    secureItems: new Map<string, string>(),
    asyncItems: new Map<string, string>(),
    isAvailableAsync: vi.fn(),
    getItem: vi.fn(),
    removeItem: vi.fn(),
    setItem: vi.fn(),
    getItemAsync: vi.fn(),
    deleteItemAsync: vi.fn(),
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
    getItemAsync: storeMocks.getItemAsync.mockImplementation(
        async (key: string) => storeMocks.secureItems.get(key) ?? null,
    ),
    setItemAsync: storeMocks.setItemAsync.mockImplementation(async (key: string, value: string) => {
        storeMocks.secureItems.set(key, value);
    }),
    deleteItemAsync: storeMocks.deleteItemAsync.mockImplementation(async (key: string) => {
        storeMocks.secureItems.delete(key);
    }),
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'whenUnlockedThisDeviceOnly',
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: storeMocks.getItem.mockImplementation(
            async (key: string) => storeMocks.asyncItems.get(key) ?? null,
        ),
        setItem: storeMocks.setItem.mockImplementation(async (key: string, value: string) => {
            storeMocks.asyncItems.set(key, value);
        }),
        removeItem: storeMocks.removeItem.mockImplementation(async (key: string) => {
            storeMocks.asyncItems.delete(key);
        }),
    },
}));

const tokens = {
    accessToken: 'dropbox-access',
    refreshToken: 'dropbox-refresh',
    expiresAt: 1_900_000_000_000,
};

describe('Dropbox credential storage', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        storeMocks.secureAvailable = true;
        storeMocks.availabilityFailuresRemaining = 0;
        storeMocks.secureItems.clear();
        storeMocks.asyncItems.clear();
    });

    it('migrates legacy plaintext tokens into secure storage on read', async () => {
        const { getStoredDropboxTokens } = await import('./dropbox-auth');
        storeMocks.asyncItems.set('@mindwtr_dropbox_tokens', JSON.stringify(tokens));

        await expect(getStoredDropboxTokens()).resolves.toEqual(tokens);

        expect(storeMocks.secureItems.get('mindwtr_dropbox_tokens')).toBe(JSON.stringify(tokens));
        expect(storeMocks.asyncItems.has('@mindwtr_dropbox_tokens')).toBe(false);
    });

    it('retries a transient availability failure without writing plaintext', async () => {
        const { saveDropboxTokens } = await import('./dropbox-auth');
        storeMocks.availabilityFailuresRemaining = 1;

        await expect(saveDropboxTokens(tokens)).rejects.toThrow('keystore probe failed');
        expect(storeMocks.setItem).not.toHaveBeenCalled();

        await expect(saveDropboxTokens(tokens)).resolves.toBeUndefined();
        expect(storeMocks.isAvailableAsync).toHaveBeenCalledTimes(2);
        expect(storeMocks.secureItems.get('mindwtr_dropbox_tokens')).toBe(JSON.stringify(tokens));
    });

    it('keeps new tokens in memory only when secure storage is unsupported', async () => {
        const { getStoredDropboxTokens, saveDropboxTokens } = await import('./dropbox-auth');
        storeMocks.secureAvailable = false;

        await saveDropboxTokens(tokens);

        expect(storeMocks.setItem).not.toHaveBeenCalled();
        expect(storeMocks.secureItems.has('mindwtr_dropbox_tokens')).toBe(false);
        await expect(getStoredDropboxTokens()).resolves.toEqual(tokens);
    });

    it('evacuates legacy plaintext tokens into memory when secure storage is unsupported', async () => {
        const { getStoredDropboxTokens } = await import('./dropbox-auth');
        storeMocks.secureAvailable = false;
        storeMocks.asyncItems.set('@mindwtr_dropbox_tokens', JSON.stringify(tokens));

        await expect(getStoredDropboxTokens()).resolves.toEqual(tokens);
        expect(storeMocks.asyncItems.has('@mindwtr_dropbox_tokens')).toBe(false);
        await expect(getStoredDropboxTokens()).resolves.toEqual(tokens);
    });
});
