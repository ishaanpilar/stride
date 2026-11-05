import type { Area } from './types';

/**
 * Area "routing context": a free-text description, short keywords and linked People. Synced and
 * optional; every helper here is pure and tolerant of old or malformed data (absent stays absent).
 */

export const AREA_DESCRIPTION_MAX_CHARS = 2000;
export const AREA_KEYWORDS_MAX = 30;
export const AREA_KEYWORD_MAX_CHARS = 40;
export const AREA_PEOPLE_MAX = 40;

/** Drops control characters except tab and newlines, then trims. */
const collapseSpaces = (value: string): string => Array.from(value)
    .filter((ch) => {
        const code = ch.charCodeAt(0);
        return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
    })
    .join('')
    .trim();

/** Trimmed description, capped; empty becomes undefined. */
export function normalizeAreaDescription(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const cleaned = collapseSpaces(value.replace(/\r\n?/g, '\n'));
    if (!cleaned) return undefined;
    return cleaned.length > AREA_DESCRIPTION_MAX_CHARS ? cleaned.slice(0, AREA_DESCRIPTION_MAX_CHARS).trimEnd() : cleaned;
}

/** Unique (case-insensitive) single-line keywords, capped; empty becomes undefined. */
export function normalizeAreaKeywords(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const seen = new Set<string>();
    const out: string[] = [];
    for (const entry of value) {
        if (typeof entry !== 'string') continue;
        const keyword = collapseSpaces(entry.replace(/\s+/g, ' ')).replace(/^[#@]+/, '').slice(0, AREA_KEYWORD_MAX_CHARS).trim();
        if (!keyword) continue;
        const key = keyword.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(keyword);
        if (out.length >= AREA_KEYWORDS_MAX) break;
    }
    return out.length > 0 ? out : undefined;
}

/** Unique non-empty People ids, capped; empty becomes undefined. */
export function normalizeAreaPeopleIds(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const out = Array.from(new Set(value.filter((id): id is string => typeof id === 'string').map((id) => id.trim()).filter(Boolean)));
    return out.length > 0 ? out.slice(0, AREA_PEOPLE_MAX) : undefined;
}

/**
 * Normalizes the context fields present in a partial Area update. Keys that are present stay present
 * (with `undefined` meaning "clear"), keys that are absent stay absent, so updates never wipe fields
 * the caller did not mention.
 */
export function normalizeAreaContextUpdates<T extends Partial<Area>>(updates: T): T {
    const has = (key: keyof Area) => Object.prototype.hasOwnProperty.call(updates, key);
    if (!has('description') && !has('keywords') && !has('peopleIds')) return updates;
    const next: Partial<Area> = { ...updates };
    if (has('description')) next.description = normalizeAreaDescription(updates.description);
    if (has('keywords')) next.keywords = normalizeAreaKeywords(updates.keywords);
    if (has('peopleIds')) next.peopleIds = normalizeAreaPeopleIds(updates.peopleIds);
    return next as T;
}

/**
 * Merge new context into an area without overwriting what is there: the description is appended
 * (unless the new text is already contained), keywords and people are unioned.
 */
export function mergeAreaContext(
    area: Pick<Area, 'description' | 'keywords' | 'peopleIds'>,
    add: { description?: string; keywords?: readonly string[]; peopleIds?: readonly string[] },
): Pick<Area, 'description' | 'keywords' | 'peopleIds'> {
    const current = normalizeAreaDescription(area.description);
    const extra = normalizeAreaDescription(add.description);
    let description = current;
    if (extra && !(current ?? '').toLowerCase().includes(extra.toLowerCase())) {
        description = normalizeAreaDescription(current ? `${current}\n${extra}` : extra);
    }
    return {
        description,
        keywords: normalizeAreaKeywords([...(area.keywords ?? []), ...(add.keywords ?? [])]),
        peopleIds: normalizeAreaPeopleIds([...(area.peopleIds ?? []), ...(add.peopleIds ?? [])]),
    };
}

const foldName = (value: string): string => value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');

function levenshtein(a: string, b: string): number {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i += 1) {
        const curr = [i];
        for (let j = 1; j <= b.length; j += 1) {
            curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
        prev = curr;
    }
    return prev[b.length];
}

/** 0..1 similarity of two names, ignoring case, accents, spaces and punctuation. */
export function areaNameSimilarity(left: string, right: string): number {
    const a = foldName(left);
    const b = foldName(right);
    if (!a || !b) return 0;
    if (a === b) return 1;
    const longest = Math.max(a.length, b.length);
    return 1 - levenshtein(a, b) / longest;
}

/** Threshold for "probably the same area" (e.g. "Fractal Works" vs "Frackly Works"). */
export const AREA_NEAR_DUPLICATE_THRESHOLD = 0.7;

/** Live areas whose name is close to (but not exactly) `name`, best first. */
export function findNearDuplicateAreas(name: string, areas: readonly Area[], threshold = AREA_NEAR_DUPLICATE_THRESHOLD): Area[] {
    const exact = name.trim().toLowerCase();
    return areas
        .filter((area) => !area.deletedAt && area.name.trim().toLowerCase() !== exact)
        .map((area) => ({ area, score: areaNameSimilarity(name, area.name) }))
        .filter((entry) => entry.score >= threshold)
        .sort((x, y) => y.score - x.score)
        .map((entry) => entry.area);
}
