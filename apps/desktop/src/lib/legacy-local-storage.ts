// One-time copy of the previous app's (Mindwtr/DoNext) localStorage keys to Stride's names.
//
// Some shared keys deliberately kept their legacy `mindwtr…` names (see the `// LEGACY:` constants
// in packages/core), while desktop-only keys were renamed to `stride…`. To keep theme, onboarding
// state, list options, Pomodoro and the like after the rename, every legacy key gets a `stride…`
// twin when that name is still empty. The legacy keys are left in place, so code still reading
// them keeps working. Imported for its side effect as the first import in main.tsx.

export const LEGACY_LOCAL_STORAGE_MIGRATION_KEY = 'stride:legacy-local-storage-migrated:v1';
const LEGACY_PREFIX = /^mindwtr(?=[-:])/;

export function migrateLegacyLocalStorage(storage: Storage | undefined): number {
    if (!storage) return 0;
    try {
        if (storage.getItem(LEGACY_LOCAL_STORAGE_MIGRATION_KEY)) return 0;
        const keys: string[] = [];
        for (let i = 0; i < storage.length; i += 1) {
            const key = storage.key(i);
            if (key && LEGACY_PREFIX.test(key)) keys.push(key);
        }
        let copied = 0;
        for (const key of keys) {
            const target = key.replace(LEGACY_PREFIX, 'stride');
            const value = storage.getItem(key);
            if (value !== null && storage.getItem(target) === null) {
                storage.setItem(target, value);
                copied += 1;
            }
        }
        storage.setItem(LEGACY_LOCAL_STORAGE_MIGRATION_KEY, new Date().toISOString());
        return copied;
    } catch {
        return 0; // storage unavailable or full: never block startup
    }
}

migrateLegacyLocalStorage(typeof window !== 'undefined' ? window.localStorage : undefined);
