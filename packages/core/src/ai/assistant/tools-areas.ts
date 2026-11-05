import type { Area, Person } from '../../types';
import {
    AREA_DESCRIPTION_MAX_CHARS,
    findNearDuplicateAreas,
    mergeAreaContext,
    normalizeAreaDescription,
    normalizeAreaKeywords,
    normalizeAreaPeopleIds,
} from '../../area-context';
import { areaPeopleNames, matchAreasForText, projectPurpose } from '../routing-context';
import { findArea, isActive, isLive, fail, shortId } from './tools';
import type { AssistantTool, JsonSchema, ToolContext, UndoOp } from './types';

/**
 * Area tools with routing context: areas carry a description (what the area is, the user's role,
 * clients, products), keywords and linked People. These are what let every AI feature route work.
 */

const peopleOf = (ctx: ToolContext): Person[] => (ctx.port.getSnapshot().people ?? []).filter((p) => !p.deletedAt);

const descriptionProp: JsonSchema = {
    type: 'string', maxLength: AREA_DESCRIPTION_MAX_CHARS,
    description: 'What this area is and what belongs here, in a few short sentences: what the company/area does, the user\'s role there, clients, products/brands, who is involved.',
};
const keywordsProp: JsonSchema = { type: 'array', items: { type: 'string', minLength: 1, maxLength: 40 }, maxItems: 30, description: 'Short routing keywords: product names, brands, clients (e.g. "Printstick").' };
const peopleProp: JsonSchema = { type: 'array', items: { type: 'string', minLength: 1, maxLength: 80 }, maxItems: 20, description: 'People names linked to this area. Existing People are matched case-insensitively.' };
const createPeopleProp: JsonSchema = { type: 'boolean', description: 'Create People that do not exist yet. Only pass true after the user agreed.' };

/** Resolve person names to ids (case-insensitive); returns the names that do not exist. */
export function resolvePeopleNames(people: readonly Person[], names: readonly string[] = []): { ids: string[]; matched: string[]; missing: string[] } {
    const byName = new Map(people.filter((p) => !p.deletedAt).map((p) => [p.name.trim().toLowerCase(), p]));
    const ids: string[] = [];
    const matched: string[] = [];
    const missing: string[] = [];
    for (const raw of names) {
        const name = raw.trim();
        if (!name) continue;
        const person = byName.get(name.toLowerCase());
        if (person) { if (!ids.includes(person.id)) { ids.push(person.id); matched.push(person.name); } }
        else if (!missing.some((m) => m.toLowerCase() === name.toLowerCase())) missing.push(name);
    }
    return { ids, matched, missing };
}

/** Links named people; creates missing ones only when allowed. Returns ids + undo ops for created people. */
async function linkPeople(ctx: ToolContext, names: readonly string[] | undefined, create: boolean) {
    const resolved = resolvePeopleNames(peopleOf(ctx), names);
    const undoOps: UndoOp[] = [];
    const created: string[] = [];
    if (create && resolved.missing.length && ctx.port.addPerson) {
        for (const name of resolved.missing.slice(0, 20)) {
            const person = await ctx.port.addPerson(name);
            if (person) { resolved.ids.push(person.id); created.push(person.name); undoOps.push({ kind: 'deletePerson', personId: person.id }); }
        }
        resolved.missing = resolved.missing.filter((name) => !created.some((c) => c.toLowerCase() === name.toLowerCase()));
    }
    return { ids: resolved.ids, created, missing: resolved.missing, undoOps };
}

const contextDetails = (area: Pick<Area, 'description' | 'keywords' | 'peopleIds'>, people: readonly Person[]): string[] => {
    const lines: string[] = [];
    const description = normalizeAreaDescription(area.description);
    if (description) lines.push(description.length > 160 ? `${description.slice(0, 159)}…` : description);
    if (area.keywords?.length) lines.push(`Keywords: ${area.keywords.join(', ')}`);
    const names = areaPeopleNames(area, people);
    if (names.length) lines.push(`People: ${names.join(', ')}`);
    return lines;
};

const missingPeopleNote = (missing: string[]) => (missing.length
    ? `These people do not exist yet: ${missing.join(', ')}. Ask the user once whether to add them as People; if yes, call update_area with people and createMissingPeople=true.`
    : undefined);

// ---- read -------------------------------------------------------------------------------

const listAreas: AssistantTool = {
    name: 'list_areas',
    description: 'List areas (ongoing responsibilities such as companies) with their description, keywords, people, and project/open task counts. Use it to decide where something belongs.',
    mutating: false,
    parameters: { type: 'object', properties: {} },
    execute: async (_a, ctx) => {
        const { areas, projects, tasks } = ctx.port.getSnapshot();
        const people = peopleOf(ctx);
        return {
            ok: true,
            data: areas.filter((a) => !a.deletedAt).map((a) => ({
                id: shortId(a.id), name: a.name, ...(a.color ? { color: a.color } : {}),
                ...(a.description ? { description: a.description.length > 400 ? `${a.description.slice(0, 399)}…` : a.description } : {}),
                ...(a.keywords?.length ? { keywords: a.keywords } : {}),
                ...(a.peopleIds?.length ? { people: areaPeopleNames(a, people) } : {}),
                projects: projects.filter((p) => !p.deletedAt && p.status !== 'archived' && p.areaId === a.id).length,
                open: tasks.filter((t) => isActive(t) && (t.areaId === a.id || projects.find((p) => p.id === t.projectId)?.areaId === a.id)).length,
            })),
        };
    },
};

const getArea: AssistantTool = {
    name: 'get_area',
    description: 'Everything known about one area ("what do you know about Frackly Works?"): full description, keywords, people, its projects with their purpose, and open task count.',
    mutating: false,
    parameters: { type: 'object', required: ['id'], properties: { id: { type: 'string', minLength: 1, description: 'Area id or name.' } } },
    validate: (a, ctx) => { const f = findArea(ctx, a.id); return 'error' in f ? f.error : null; },
    execute: async (a, ctx) => {
        const area = (findArea(ctx, a.id) as { area: Area }).area;
        const { projects, tasks } = ctx.port.getSnapshot();
        const inArea = projects.filter((p) => !p.deletedAt && p.status !== 'archived' && p.areaId === area.id);
        return {
            ok: true,
            data: {
                id: shortId(area.id), name: area.name,
                description: area.description ?? null,
                keywords: area.keywords ?? [],
                people: areaPeopleNames(area, peopleOf(ctx)),
                projects: inArea.slice(0, 30).map((p) => ({ id: shortId(p.id), title: p.title, ...(projectPurpose(p) ? { purpose: projectPurpose(p) } : {}) })),
                openTasks: tasks.filter((t) => isActive(t) && (t.areaId === area.id || inArea.some((p) => p.id === t.projectId))).length,
                ...(area.description || area.keywords?.length || area.peopleIds?.length ? {} : { note: 'This area has no description yet. Offer to add one.' }),
            },
        };
    },
};

const findAreaCandidates: AssistantTool = {
    name: 'find_area_candidates',
    description: 'After creating or describing an area: find tasks (not in a project) and projects outside this area whose title or notes mention its name, keywords, products or people. Propose moving them as ONE apply_plan (update_task with areaId / assign_project_to_area). Changes nothing.',
    mutating: false,
    parameters: { type: 'object', required: ['id'], properties: { id: { type: 'string', minLength: 1, description: 'Area id or name.' } } },
    validate: (a, ctx) => { const f = findArea(ctx, a.id); return 'error' in f ? f.error : null; },
    execute: async (a, ctx) => {
        const area = (findArea(ctx, a.id) as { area: Area }).area;
        const { tasks, projects } = ctx.port.getSnapshot();
        const people = peopleOf(ctx);
        const reasonFor = (text: string) => matchAreasForText(text, [area], people)[0]?.reason;
        const projectRows = projects
            .filter((p) => !p.deletedAt && p.status !== 'archived' && p.areaId !== area.id)
            .map((p) => ({ p, reason: reasonFor(`${p.title} ${p.supportNotes ?? ''}`) }))
            .filter((r) => r.reason)
            .slice(0, 25)
            .map(({ p, reason }) => ({ id: shortId(p.id), title: p.title, reason }));
        const taskRows = tasks
            .filter((t) => isLive(t) && isActive(t) && !t.projectId && t.areaId !== area.id)
            .map((t) => ({ t, reason: reasonFor(`${t.title} ${t.description ?? ''}`) }))
            .filter((r) => r.reason)
            .slice(0, 40)
            .map(({ t, reason }) => ({ id: shortId(t.id), title: t.title, reason }));
        return { ok: true, data: { area: area.name, projects: projectRows, tasks: taskRows } };
    },
};

// ---- write ------------------------------------------------------------------------------

const addArea: AssistantTool = {
    name: 'add_area',
    description: 'Create an area (an ongoing responsibility, e.g. a company the user runs) with optional routing context: description, keywords, people. Write the description as a short structured summary of what the user told you (what it does, their role, products/brands, people). Near-duplicate names are refused: ask the user first.',
    mutating: true,
    parameters: {
        type: 'object', required: ['name'],
        properties: {
            name: { type: 'string', minLength: 1, maxLength: 100 },
            color: { type: 'string', description: 'Hex like "#10b981".' },
            description: descriptionProp,
            keywords: keywordsProp,
            people: peopleProp,
            createMissingPeople: createPeopleProp,
            allowSimilarName: { type: 'boolean', description: 'Create even though a similarly named area exists. Only after the user chose "create new".' },
        },
    },
    validate: (a, ctx) => {
        if (a.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(a.color)) return 'color must be a hex colour like "#10b981".';
        const areas = ctx.port.getSnapshot().areas;
        const dup = areas.find((x) => !x.deletedAt && x.name.trim().toLowerCase() === a.name.trim().toLowerCase());
        if (dup) return `An area named "${dup.name}" already exists (${shortId(dup.id)}). To add context to it, call update_area (mode "append").`;
        const similar = a.allowSimilarName === true ? [] : findNearDuplicateAreas(a.name, areas);
        if (similar.length) {
            const names = similar.slice(0, 3).map((x) => `"${x.name}" (${shortId(x.id)})`).join(', ');
            return `Similar area already exists: ${names}. Do not create a duplicate. Ask the user ONE question: use "${similar[0].name}" or create a new area "${a.name}"? Offer both as suggestions. If they pick the existing one, call update_area on it (mode "append"); if they want a new one, call add_area again with allowSimilarName=true.`;
        }
        return null;
    },
    execute: async (a, ctx) => {
        const linked = await linkPeople(ctx, a.people, a.createMissingPeople === true);
        const props: Partial<Area> = {};
        if (a.color) props.color = a.color;
        const description = normalizeAreaDescription(a.description);
        const keywords = normalizeAreaKeywords(a.keywords);
        const peopleIds = normalizeAreaPeopleIds(linked.ids);
        if (description) props.description = description;
        if (keywords) props.keywords = keywords;
        if (peopleIds) props.peopleIds = peopleIds;
        const area = await ctx.port.addArea(a.name.trim(), props);
        if (!area) return fail('Could not create the area');
        const details = contextDetails({ description, keywords, peopleIds }, peopleOf(ctx));
        if (linked.created.length) details.push(`New people: ${linked.created.join(', ')}`);
        return {
            ok: true,
            data: {
                id: shortId(area.id), name: area.name,
                ...(linked.missing.length ? { missingPeople: linked.missing, note: missingPeopleNote(linked.missing) } : {}),
                next: 'Call find_area_candidates to offer moving existing tasks/projects that mention this area into it.',
            },
            change: {
                kind: 'area',
                label: `Created area '${area.name}'${details.length ? ' with context' : ''}`,
                ...(details.length ? { details } : {}),
                // Undo deletes the area first, then any people it created.
                undoOps: [{ kind: 'deleteArea', areaId: area.id }, ...linked.undoOps],
                changes: [{ taskId: area.id, title: area.name, before: {}, after: { area: area.name, ...props } }],
            },
        };
    },
};

const updateArea: AssistantTool = {
    name: 'update_area',
    description: 'Rename an area, change its colour, or add to its routing context. By default (mode "append") new description text is appended and keywords/people are merged, never overwritten ("add to the Frackly Works context: Akash handles packaging"). Use mode "replace" only when the user asks to rewrite it.',
    mutating: true,
    parameters: {
        type: 'object', required: ['id'],
        properties: {
            id: { type: 'string', minLength: 1, description: 'Area id or name.' },
            name: { type: 'string', minLength: 1, maxLength: 100 },
            color: { type: 'string' },
            description: descriptionProp,
            keywords: keywordsProp,
            people: peopleProp,
            createMissingPeople: createPeopleProp,
            mode: { type: 'string', enum: ['append', 'replace'], description: 'append (default): merge into the existing context. replace: overwrite the given fields.' },
        },
    },
    validate: (a, ctx) => {
        const f = findArea(ctx, a.id);
        if ('error' in f) return f.error;
        if (['name', 'color', 'description', 'keywords', 'people'].every((k) => a[k] === undefined)) return 'Nothing to change: pass name, color, description, keywords or people.';
        return a.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(a.color) ? 'color must be a hex colour.' : null;
    },
    execute: async (a, ctx) => {
        const area = (findArea(ctx, a.id) as { area: Area }).area;
        const replace = a.mode === 'replace';
        const linked = a.people !== undefined ? await linkPeople(ctx, a.people, a.createMissingPeople === true) : { ids: [] as string[], created: [] as string[], missing: [] as string[], undoOps: [] as UndoOp[] };
        const updates: Partial<Area> = {};
        if (a.name !== undefined) updates.name = a.name;
        if (a.color !== undefined) updates.color = a.color;
        const touchesContext = a.description !== undefined || a.keywords !== undefined || a.people !== undefined;
        if (touchesContext) {
            if (replace) {
                if (a.description !== undefined) updates.description = normalizeAreaDescription(a.description);
                if (a.keywords !== undefined) updates.keywords = normalizeAreaKeywords(a.keywords);
                if (a.people !== undefined) updates.peopleIds = normalizeAreaPeopleIds(linked.ids);
            } else {
                const merged = mergeAreaContext(area, { description: a.description, keywords: a.keywords, peopleIds: linked.ids });
                if (a.description !== undefined) updates.description = merged.description;
                if (a.keywords !== undefined) updates.keywords = merged.keywords;
                if (a.people !== undefined) updates.peopleIds = merged.peopleIds;
            }
        }
        const before: Record<string, unknown> = {}; const fields: Record<string, unknown> = {}; const clear: string[] = [];
        for (const k of Object.keys(updates)) { const v = (area as unknown as Record<string, unknown>)[k]; if (v === undefined) clear.push(k); else { fields[k] = v; before[k] = v; } }
        const res = await ctx.port.updateArea(area.id, updates);
        if (!res.success) {
            // Roll back people created for this call.
            for (const op of linked.undoOps) if (op.kind === 'deletePerson') await ctx.port.deletePerson?.(op.personId);
            return fail(res.error ?? 'Could not update the area');
        }
        const details = touchesContext ? contextDetails({ ...area, ...updates }, peopleOf(ctx)) : [];
        if (linked.created.length) details.push(`New people: ${linked.created.join(', ')}`);
        const label = a.name && a.name !== area.name
            ? `Renamed area '${area.name}' to '${a.name}'`
            : touchesContext ? `${replace ? 'Rewrote' : 'Added to'} the context of '${area.name}'` : `Updated area '${area.name}'`;
        return {
            ok: true,
            data: {
                id: shortId(area.id),
                ...(touchesContext ? { description: updates.description ?? area.description ?? null, keywords: updates.keywords ?? area.keywords ?? [] } : {}),
                ...(linked.missing.length ? { missingPeople: linked.missing, note: missingPeopleNote(linked.missing) } : {}),
            },
            change: {
                kind: 'area', label,
                ...(details.length ? { details } : {}),
                undoOps: [{ kind: 'restoreAreaFields', areaId: area.id, fields: fields as Partial<Area>, clear }, ...linked.undoOps],
                changes: [{ taskId: area.id, title: area.name, before, after: { ...updates } }],
            },
        };
    },
};

export const AREA_TOOLS: AssistantTool[] = [listAreas, getArea, findAreaCandidates, addArea, updateArea];
