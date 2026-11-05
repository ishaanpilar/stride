import { describe, expect, it } from 'vitest';
import {
    AREA_DESCRIPTION_MAX_CHARS,
    AREA_KEYWORDS_MAX,
    areaNameSimilarity,
    findNearDuplicateAreas,
    mergeAreaContext,
    normalizeAreaContextUpdates,
    normalizeAreaDescription,
    normalizeAreaKeywords,
    normalizeAreaPeopleIds,
} from './area-context';
import { AREA_SYNC_SCHEMA_FIXTURE, areaFromSqliteRow, areaToSqliteRow, AREA_SQLITE_COLUMNS } from './area-sync-schema';
import { normalizeAreaForSyncMerge } from './sync-normalization';
import { normalizeAreaForContentComparison } from './sync-signatures';
import type { Area } from './types';

const NOW = '2026-11-05T10:00:00.000Z';
const area = (overrides: Partial<Area> = {}): Area => ({
    id: 'a1', name: 'Frackly Works', order: 0, createdAt: NOW, updatedAt: NOW, ...overrides,
});
const rowOf = (a: Area): Record<string, unknown> => {
    const values = areaToSqliteRow(a, NOW);
    return Object.fromEntries(AREA_SQLITE_COLUMNS.map((column, index) => [column, values[index]]));
};

describe('area context normalization', () => {
    it('trims and caps the description; empty becomes undefined', () => {
        expect(normalizeAreaDescription('  3D printing  ')).toBe('3D printing');
        expect(normalizeAreaDescription('   ')).toBeUndefined();
        expect(normalizeAreaDescription(42)).toBeUndefined();
        expect(normalizeAreaDescription('x'.repeat(AREA_DESCRIPTION_MAX_CHARS + 50))).toHaveLength(AREA_DESCRIPTION_MAX_CHARS);
    });

    it('dedupes keywords case-insensitively, strips # and caps the list', () => {
        expect(normalizeAreaKeywords(['Printstick', 'printstick', '#3D printing', '', 7])).toEqual(['Printstick', '3D printing']);
        expect(normalizeAreaKeywords([])).toBeUndefined();
        expect(normalizeAreaKeywords('nope')).toBeUndefined();
        expect(normalizeAreaKeywords(Array.from({ length: 50 }, (_, i) => `k${i}`))).toHaveLength(AREA_KEYWORDS_MAX);
    });

    it('dedupes people ids', () => {
        expect(normalizeAreaPeopleIds(['p1', 'p1', ' p2 ', '', null])).toEqual(['p1', 'p2']);
        expect(normalizeAreaPeopleIds([])).toBeUndefined();
    });

    it('only touches context keys that are present in an update', () => {
        const untouched = { name: 'X' };
        expect(normalizeAreaContextUpdates(untouched)).toBe(untouched);
        const cleared = normalizeAreaContextUpdates({ description: '  ', keywords: [] });
        expect(cleared).toEqual({ description: undefined, keywords: undefined });
        expect('peopleIds' in cleared).toBe(false);
    });

    it('merges by appending text and unioning keywords and people (never overwriting)', () => {
        const merged = mergeAreaContext(
            { description: '3D printing company.', keywords: ['Printstick'], peopleIds: ['p1'] },
            { description: 'Akash handles packaging.', keywords: ['printstick', 'Packaging'], peopleIds: ['p2', 'p1'] },
        );
        expect(merged.description).toBe('3D printing company.\nAkash handles packaging.');
        expect(merged.keywords).toEqual(['Printstick', 'Packaging']);
        expect(merged.peopleIds).toEqual(['p1', 'p2']);
        // Appending text that is already there is a no-op.
        expect(mergeAreaContext(merged, { description: 'akash handles packaging.' }).description).toBe(merged.description);
    });
});

describe('near-duplicate area names', () => {
    it('treats a voice-transcription variant as the same area', () => {
        expect(areaNameSimilarity('Fractal Works', 'Frackly Works')).toBeGreaterThanOrEqual(0.7);
        expect(findNearDuplicateAreas('Fractal Works', [area(), area({ id: 'a2', name: 'Mad Dog' })]).map((a) => a.name)).toEqual(['Frackly Works']);
    });

    it('ignores exact matches, deleted areas and unrelated names', () => {
        expect(findNearDuplicateAreas('Frackly Works', [area()])).toEqual([]);
        expect(findNearDuplicateAreas('Fractal Works', [area({ deletedAt: NOW })])).toEqual([]);
        expect(findNearDuplicateAreas('Happy Labs', [area(), area({ id: 'a2', name: 'Mad Dog' })])).toEqual([]);
    });
});

describe('area context sync schema', () => {
    it('round-trips the schema fixture through SQLite rows', () => {
        const back = areaFromSqliteRow(rowOf(AREA_SYNC_SCHEMA_FIXTURE), NOW);
        expect(back.description).toBe(AREA_SYNC_SCHEMA_FIXTURE.description);
        expect(back.keywords).toEqual(AREA_SYNC_SCHEMA_FIXTURE.keywords);
        expect(back.peopleIds).toEqual(AREA_SYNC_SCHEMA_FIXTURE.peopleIds);
    });

    it('keeps old areas without context unchanged (no new keys, NULL columns)', () => {
        const old = area();
        const row = rowOf(old);
        expect(row.description).toBeNull();
        expect(row.keywords).toBeNull();
        expect(row.peopleIds).toBeNull();
        const back = areaFromSqliteRow({ ...row, description: undefined, keywords: undefined, peopleIds: undefined }, NOW);
        expect('description' in back || 'keywords' in back || 'peopleIds' in back).toBe(false);
        const merged = normalizeAreaForSyncMerge(old, NOW);
        expect(Object.keys(merged).filter((k) => ['description', 'keywords', 'peopleIds'].includes(k))).toEqual([]);
    });

    it('tolerates malformed stored JSON', () => {
        const back = areaFromSqliteRow({ ...rowOf(area()), keywords: '{not json', peopleIds: '"x"' }, NOW);
        expect(back.keywords).toBeUndefined();
        expect(back.peopleIds).toBeUndefined();
    });

    it('normalizes context for sync merge and ignores empty values in content comparison', () => {
        const merged = normalizeAreaForSyncMerge(area({ description: '  hi  ', keywords: ['a', 'A'], peopleIds: [] }), NOW);
        expect(merged.description).toBe('hi');
        expect(merged.keywords).toEqual(['a']);
        expect(merged.peopleIds).toBeUndefined();
        const left = normalizeAreaForContentComparison(area({ keywords: [], description: ' ' }));
        const right = normalizeAreaForContentComparison(area());
        expect(left.keywords).toBeUndefined();
        expect(left.description).toBeUndefined();
        expect(right.keywords).toBeUndefined();
    });
});
