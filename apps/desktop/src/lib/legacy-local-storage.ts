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

export const LEGACY_WEBKIT_IMPORT_KEY = 'stride:legacy-webkit-import:v1';

/**
 * Adds rows read from a previous install's WebKit storage (another origin/profile, read natively)
 * that this storage lacks, under both the legacy and the `stride…` name. Returns how many were added.
 */
export function importLegacyLocalStorageItems(storage: Storage, items: Array<[string, string]>): number {
    let added = 0;
    for (const [key, value] of items) {
        if (typeof key !== 'string' || typeof value !== 'string') continue;
        const names = LEGACY_PREFIX.test(key) ? [key, key.replace(LEGACY_PREFIX, 'stride')] : [key];
        for (const name of names) {
            if (storage.getItem(name) === null) {
                storage.setItem(name, value);
                added += 1;
            }
        }
    }
    return added;
}

/** One-time import from the previous install (Tauri only); reloads once when anything was added. */
async function importLegacyWebKitStorage(storage: Storage): Promise<void> {
    if (storage.getItem(LEGACY_WEBKIT_IMPORT_KEY)) return;
    const { invokeNative } = await import('./tauri-invoke');
    const items = await invokeNative<Array<[string, string]>>('legacy_local_storage_items');
    if (storage.getItem(LEGACY_WEBKIT_IMPORT_KEY)) return; // another window finished first
    const added = importLegacyLocalStorageItems(storage, Array.isArray(items) ? items : []);
    storage.setItem(LEGACY_WEBKIT_IMPORT_KEY, new Date().toISOString());
    if (added > 0) window.location.reload();
}

if (typeof window !== 'undefined') {
    migrateLegacyLocalStorage(window.localStorage);
    if ('__TAURI_INTERNALS__' in window) {
        importLegacyWebKitStorage(window.localStorage).catch(() => {
            // best effort: never block startup
        });
    }
}
