import AsyncStorage from '@react-native-async-storage/async-storage';
import { threadKey, type ThreadStorage } from '@stride/core';

/**
 * The Assistant core wants a synchronous storage. AsyncStorage is async, so reads come from an
 * in-memory cache that `warm()` fills for today's thread; writes go through to AsyncStorage.
 */
export function createCachedThreadStorage(backing: Pick<typeof AsyncStorage, 'getItem' | 'setItem' | 'removeItem'> = AsyncStorage) {
    const cache = new Map<string, string>();
    const storage: ThreadStorage = {
        getItem: (key) => cache.get(key) ?? null,
        setItem: (key, value) => {
            cache.set(key, value);
            void Promise.resolve(backing.setItem(key, value)).catch(() => undefined);
        },
        removeItem: (key) => {
            cache.delete(key);
            void Promise.resolve(backing.removeItem(key)).catch(() => undefined);
        },
    };
    const warm = async (now: Date = new Date()): Promise<void> => {
        const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const key = threadKey(day);
        try {
            const value = await backing.getItem(key);
            if (value != null && !cache.has(key)) cache.set(key, value);
        } catch {
            // best effort: start with an empty thread
        }
    };
    return { storage, warm };
}
