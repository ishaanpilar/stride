/**
 * Local, unsynced log of routing corrections: when the AI put something in an area/project and the
 * user moved it, we remember "this kind of thing goes there" and feed a short summary back into
 * the routing context. Pure helpers; the platform owns storage (desktop: localStorage).
 */

export const ROUTING_CORRECTIONS_STORAGE_KEY = 'stride:ai:routing-corrections:v1';
export const ROUTING_CORRECTIONS_MAX = 100;
const TEXT_MAX = 120;
const NAME_MAX = 80;

export interface RoutingCorrection {
    /** ISO time of the correction. */
    at: string;
    /** The task/item title the correction is about. */
    text: string;
    /** Where the AI put it (names, not ids, so the summary stays readable). */
    fromArea?: string;
    fromProject?: string;
    /** Where the user moved it. */
    toArea?: string;
    toProject?: string;
}

const clean = (value: unknown, max: number): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const flat = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!flat) return undefined;
    return flat.length > max ? flat.slice(0, max).trimEnd() : flat;
};

/** Validates one entry; returns null when it is not a usable correction. */
export function normalizeRoutingCorrection(value: unknown): RoutingCorrection | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const text = clean(record.text, TEXT_MAX);
    const at = typeof record.at === 'string' && !Number.isNaN(Date.parse(record.at)) ? record.at : undefined;
    const entry: RoutingCorrection = { at: at ?? new Date(0).toISOString(), text: text ?? '' };
    const fromArea = clean(record.fromArea, NAME_MAX);
    const fromProject = clean(record.fromProject, NAME_MAX);
    const toArea = clean(record.toArea, NAME_MAX);
    const toProject = clean(record.toProject, NAME_MAX);
    if (fromArea) entry.fromArea = fromArea;
    if (fromProject) entry.fromProject = fromProject;
    if (toArea) entry.toArea = toArea;
    if (toProject) entry.toProject = toProject;
    if (!text || !at) return null;
    // A correction must say where the item now belongs, and actually differ from where it was.
    if (!toArea && !toProject) return null;
    if ((toArea ?? '') === (fromArea ?? '') && (toProject ?? '') === (fromProject ?? '')) return null;
    return entry;
}

export function parseRoutingCorrections(raw: string | null | undefined): RoutingCorrection[] {
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.map(normalizeRoutingCorrection).filter((e): e is RoutingCorrection => e !== null).slice(-ROUTING_CORRECTIONS_MAX);
    } catch {
        return [];
    }
}

export function serializeRoutingCorrections(list: readonly RoutingCorrection[]): string {
    return JSON.stringify(list.slice(-ROUTING_CORRECTIONS_MAX));
}

/** Appends a correction (newest last), replacing an older one about the same text, capped. */
export function recordRoutingCorrection(list: readonly RoutingCorrection[], entry: unknown): RoutingCorrection[] {
    const normalized = normalizeRoutingCorrection(entry);
    if (!normalized) return list.slice(-ROUTING_CORRECTIONS_MAX);
    const key = normalized.text.toLowerCase();
    const rest = list.filter((existing) => existing.text.toLowerCase() !== key);
    return [...rest, normalized].slice(-ROUTING_CORRECTIONS_MAX);
}

/** Short human lines for the routing context, newest first, e.g. `'Quote for Akash' → Mauvi Labs (not Prad)`. */
export function summarizeRoutingCorrections(list: readonly RoutingCorrection[], max = 10): string[] {
    const lines: string[] = [];
    const seen = new Set<string>();
    for (const entry of [...list].reverse()) {
        const key = entry.text.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const to = [entry.toArea, entry.toProject && `project ${entry.toProject}`].filter(Boolean).join(' / ');
        const from = [entry.fromArea, entry.fromProject && `project ${entry.fromProject}`].filter(Boolean).join(' / ');
        lines.push(`'${entry.text}' belongs in ${to}${from ? ` (not ${from})` : ''}`);
        if (lines.length >= max) break;
    }
    return lines;
}
