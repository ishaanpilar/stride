import { beforeEach, describe, expect, it } from 'vitest';

import { LEGACY_LOCAL_STORAGE_MIGRATION_KEY, importLegacyLocalStorageItems, migrateLegacyLocalStorage } from './legacy-local-storage';

// A spec-shaped Storage (the shared test mock has no key()/length).
class MemoryStorage implements Storage {
    private map = new Map<string, string>();
    get length() { return this.map.size; }
    clear() { this.map.clear(); }
    getItem(key: string) { return this.map.has(key) ? this.map.get(key)! : null; }
    key(index: number) { return [...this.map.keys()][index] ?? null; }
    removeItem(key: string) { this.map.delete(key); }
    setItem(key: string, value: string) { this.map.set(key, String(value)); }
}

let localStorage: Storage;

describe('legacy localStorage migration', () => {
    beforeEach(() => { localStorage = new MemoryStorage(); });

    it('copies mindwtr keys to stride names and keeps the originals', () => {
        localStorage.setItem('mindwtr-theme', 'dark');
        localStorage.setItem('mindwtr:desktop:first-run-onboarding:v1', 'done');
        localStorage.setItem('unrelated', 'x');
        expect(migrateLegacyLocalStorage(localStorage)).toBe(2);
        expect(localStorage.getItem('stride-theme')).toBe('dark');
        expect(localStorage.getItem('stride:desktop:first-run-onboarding:v1')).toBe('done');
        expect(localStorage.getItem('mindwtr-theme')).toBe('dark');
        expect(localStorage.getItem('stride-unrelated')).toBeNull();
    });

    it('never overwrites a value Stride already has', () => {
        localStorage.setItem('mindwtr-theme', 'dark');
        localStorage.setItem('stride-theme', 'light');
        migrateLegacyLocalStorage(localStorage);
        expect(localStorage.getItem('stride-theme')).toBe('light');
    });

    it('runs only once', () => {
        localStorage.setItem(LEGACY_LOCAL_STORAGE_MIGRATION_KEY, 'earlier');
        localStorage.setItem('mindwtr-theme', 'dark');
        expect(migrateLegacyLocalStorage(localStorage)).toBe(0);
        expect(localStorage.getItem('stride-theme')).toBeNull();
    });

    it('ignores keys that merely contain the old name', () => {
        localStorage.setItem('mindwtrish', 'x');
        expect(migrateLegacyLocalStorage(localStorage)).toBe(0);
    });

    it('imports rows from a previous install under both names without overwriting', () => {
        localStorage.setItem('stride-theme', 'light');
        const added = importLegacyLocalStorageItems(localStorage, [
            ['mindwtr-theme', 'dark'],
            ['mindwtr:assistant:thread:2026-11-04', '[]'],
            ['other', 'x'],
        ]);
        expect(localStorage.getItem('stride-theme')).toBe('light');
        expect(localStorage.getItem('mindwtr-theme')).toBe('dark');
        expect(localStorage.getItem('mindwtr:assistant:thread:2026-11-04')).toBe('[]');
        expect(localStorage.getItem('stride:assistant:thread:2026-11-04')).toBe('[]');
        expect(localStorage.getItem('other')).toBe('x');
        expect(added).toBe(4);
        expect(importLegacyLocalStorageItems(localStorage, [['mindwtr-theme', 'dark']])).toBe(0);
    });
});
