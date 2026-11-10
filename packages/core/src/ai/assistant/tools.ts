import { generateUUID } from '../../uuid';
import type { Area, ChecklistItem, Project, Task, TaskPriority, TaskStatus } from '../../types';
import { cleanReason } from '../mind-sweep-ai';
import { projectPurpose } from '../routing-context';
import { MAX_TASK_BLOCKERS, canAddDependency, createTaskLookup, getBlockers, getOpenBlockers, isBlockerOpen, normalizeBlockedByTaskIds, type TaskLookup } from '../../task-dependencies';
import { addLocalDays, dayKeyOf, formatWhen, hasTimeOf, parseWhen, shiftWhen, startOfLocalDay, toLocalDay } from './dates';
import type {
    AssistantTool,
    ChangeEntry,
    JsonSchema,
    ToolContext,
    ToolOutcome,
    UndoOp,
} from './types';

/** Confirmation gate: any change touching more than this many tasks needs user approval. */
export const BULK_CONFIRM_THRESHOLD = 3;

export const STATUSES = ['inbox', 'next', 'waiting', 'someday', 'reference', 'done'] as const;
export const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export const PROJECT_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

export const shortId = (id: string) => id.slice(0, 8);
export const isLive = (t: Task) => !t.deletedAt && !t.purgedAt;
export const isActive = (t: Task) => isLive(t) && t.status !== 'done' && t.status !== 'archived' && t.status !== 'reference';

// ---- lookup helpers -------------------------------------------------------------------

export function findTask(ctx: ToolContext, ref: string): { task: Task } | { error: string } {
    const { tasks } = ctx.port.getSnapshot();
    const live = tasks.filter(isLive);
    const exact = live.find((t) => t.id === ref);
    if (exact) return { task: exact };
    if (ref.length >= 4) {
        const matches = live.filter((t) => t.id.startsWith(ref));
        if (matches.length === 1) return { task: matches[0] };
        if (matches.length > 1) return { error: `Task id "${ref}" is ambiguous; use a longer id.` };
    }
    return { error: `Unknown task id "${ref}". Use list_tasks to find real ids; never guess ids.` };
}

export function findProject(ctx: ToolContext, ref: string): { project: Project } | { error: string } {
    const { projects } = ctx.port.getSnapshot();
    const live = projects.filter((p) => !p.deletedAt && p.status !== 'archived');
    const exact = live.find((p) => p.id === ref) ?? (ref.length >= 4 ? live.find((p) => p.id.startsWith(ref)) : undefined);
    if (exact) return { project: exact };
    const lower = ref.trim().toLowerCase();
    const byTitle = live.filter((p) => p.title.toLowerCase() === lower);
    if (byTitle.length === 1) return { project: byTitle[0] };
    const partial = live.filter((p) => p.title.toLowerCase().includes(lower));
    if (partial.length === 1) return { project: partial[0] };
    return { error: `Unknown project "${ref}". Known projects: ${live.slice(0, 20).map((p) => `${p.title} (${shortId(p.id)})`).join('; ') || 'none'}. Use list_projects or add_project.` };
}

export function findArea(ctx: ToolContext, ref: string): { area: Area } | { error: string } {
    const live = ctx.port.getSnapshot().areas.filter((a) => !a.deletedAt);
    const exact = live.find((a) => a.id === ref) ?? (ref.length >= 4 ? live.find((a) => a.id.startsWith(ref)) : undefined);
    if (exact) return { area: exact };
    const lower = ref.trim().toLowerCase();
    const byName = live.filter((a) => a.name.toLowerCase() === lower);
    if (byName.length === 1) return { area: byName[0] };
    const partial = live.filter((a) => a.name.toLowerCase().includes(lower));
    if (partial.length === 1) return { area: partial[0] };
    return { error: `Unknown area "${ref}". Known areas: ${live.map((a) => `${a.name} (${shortId(a.id)})`).join('; ') || 'none'}. Use list_areas.` };
}

/** Validated, short routing explanation from tool args (or undefined). */
export const reasonOf = (value: unknown): string | undefined => cleanReason(value);

export const reasonProp: JsonSchema = { type: 'string', maxLength: 160, description: 'Short why for the area/project you chose (at most 12 words), e.g. "mentions Akash -> Mauvi Labs". Shown to the user.' };

export const compact = (t: Task, projects: Project[], lookup?: TaskLookup) => {
    const project = t.projectId ? projects.find((p) => p.id === t.projectId) : undefined;
    const openBlockers = lookup && isActive(t) ? getOpenBlockers(t, lookup) : [];
    return {
        id: shortId(t.id),
        title: t.title,
        status: t.status,
        ...(t.dueDate ? { due: t.dueDate } : {}),
        ...(t.startTime ? { start: t.startTime } : {}),
        ...(t.priority ? { priority: t.priority } : {}),
        ...(project ? { project: project.title } : {}),
        ...(t.contexts?.length ? { contexts: t.contexts } : {}),
        ...(openBlockers.length ? { waitsFor: openBlockers.map((b) => ({ id: shortId(b.id), title: b.title })) } : {}),
    };
};

export const normContexts = (items?: string[]) => (items ?? []).map((c) => c.trim()).filter(Boolean).map((c) => (c.startsWith('@') ? c : `@${c}`));
export const normTags = (items?: string[]) => (items ?? []).map((c) => c.trim()).filter(Boolean).map((c) => (c.startsWith('#') ? c : `#${c}`));
export const dedupe = <T,>(items: T[]) => Array.from(new Set(items));

export function snapshotFields(task: Task, keys: string[]): { before: Record<string, unknown>; fields: Partial<Task>; clear: string[] } {
    const before: Record<string, unknown> = {};
    const fields: Record<string, unknown> = {};
    const clear: string[] = [];
    for (const key of keys) {
        const value = (task as unknown as Record<string, unknown>)[key];
        if (value === undefined) clear.push(key);
        else {
            fields[key] = value;
            before[key] = value;
        }
    }
    return { before, fields: fields as Partial<Task>, clear };
}

/** Applies an update through the store and returns the undo/audit record. */
export async function applyUpdate(ctx: ToolContext, task: Task, updates: Partial<Task>) {
    const keys = Object.keys(updates);
    const snap = snapshotFields(task, keys);
    const res = await ctx.port.updateTask(task.id, updates);
    if (!res.success) return { error: res.error ?? 'Update failed' };
    const after: Record<string, unknown> = {};
    for (const k of keys) after[k] = (updates as Record<string, unknown>)[k] ?? null;
    return {
        undo: { kind: 'restoreFields', taskId: task.id, fields: snap.fields, clear: snap.clear } as UndoOp,
        change: { taskId: task.id, title: task.title, before: snap.before, after },
    };
}

export const fail = (error: string): ToolOutcome => ({ ok: false, error });

export const dateProp = (what: string): JsonSchema => ({ type: 'string', description: `${what}. Local "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm" (24h).` });
export const idProp: JsonSchema = { type: 'string', minLength: 1, description: 'Task id from list_tasks / get_task.' };

export function validateWhen(ctx: ToolContext, value: unknown, label: string, allowPast = false): string | null {
    if (value === undefined || value === null) return null;
    const r = parseWhen(String(value), ctx.now, { allowPast });
    return r.ok ? null : `${label}: ${r.error}`;
}

export const normWhen = (ctx: ToolContext, v: string) => {
    const r = parseWhen(v, ctx.now, { allowPast: true });
    return r.ok ? r.value : v;
};

export const blockedByProp: JsonSchema = {
    type: 'array',
    maxItems: MAX_TASK_BLOCKERS,
    items: { type: 'string', minLength: 1 },
    description: 'Tasks that must finish first: id from list_tasks, or an exact task title. The task stays hidden from Focus and Next until they are done.',
};

function findBlockerTask(ctx: ToolContext, ref: string): { task: Task } | { error: string } {
    const byId = findTask(ctx, ref);
    if ('task' in byId) return byId;
    const lower = ref.trim().toLowerCase();
    const live = ctx.port.getSnapshot().tasks.filter(isLive);
    const named = live.filter((t) => t.title.trim().toLowerCase() === lower);
    const open = named.filter(isActive);
    const matches = open.length > 0 ? open : named;
    if (matches.length === 1) return { task: matches[0] };
    if (matches.length > 1) return { error: `Several tasks are titled "${ref}": ${matches.slice(0, 5).map((t) => shortId(t.id)).join(', ')}. Pass the id.` };
    return { error: `Unknown task "${ref}". Use list_tasks to find the task that must finish first.` };
}

export function resolveBlockers(ctx: ToolContext, refs: unknown, task?: Task): { tasks: Task[] } | { error: string } {
    if (!Array.isArray(refs)) return { error: 'blockedBy must be a list of task ids or exact titles.' };
    if (refs.length > MAX_TASK_BLOCKERS) return { error: `A task can wait for at most ${MAX_TASK_BLOCKERS} other tasks.` };
    const lookup = createTaskLookup(ctx.port.getSnapshot().tasks);
    const resolved: Task[] = [];
    for (const ref of refs as string[]) {
        const found = findBlockerTask(ctx, ref);
        if ('error' in found) return found;
        const blocker = found.task;
        const stillOpen: boolean = isBlockerOpen(blocker);
        if (!stillOpen) return { error: `"${blocker.title}" is already finished, so it cannot block anything.` };
        if (task) {
            const check = canAddDependency(task.id, blocker.id, lookup);
            if (!check.ok && check.reason === 'self') return { error: 'A task cannot wait for itself.' };
            if (!check.ok && check.reason === 'cycle') {
                return { error: `"${task.title}" cannot wait for "${blocker.title}": "${blocker.title}" already waits for "${task.title}" (directly or through other tasks), which would block both forever.` };
            }
        }
        if (!resolved.some((t) => t.id === blocker.id)) resolved.push(blocker);
    }
    return { tasks: resolved };
}

function checklistFrom(steps: string[]): ChecklistItem[] {
    return steps.map((title) => ({ id: generateUUID(), title, isCompleted: false }));
}

// ---- tools ----------------------------------------------------------------------------

const listTasks: AssistantTool = {
    name: 'list_tasks',
    description: 'Search/list tasks. Defaults to open tasks (inbox, next, waiting, someday). Returns compact rows with short ids.',
    mutating: false,
    parameters: {
        type: 'object',
        properties: {
            status: { type: 'string', enum: [...STATUSES, 'open', 'all'], description: 'Status filter; "open" (default) excludes done/reference.' },
            dueFrom: dateProp('Only tasks due on/after this day'),
            dueTo: dateProp('Only tasks due on/before this day'),
            overdue: { type: 'boolean', description: 'Only tasks due before today.' },
            projectId: { type: 'string' },
            project: { type: 'string', description: 'Project title (case-insensitive).' },
            context: { type: 'string' },
            tag: { type: 'string' },
            priority: { type: 'string', enum: PRIORITIES },
            search: { type: 'string', description: 'Case-insensitive text in title/notes.' },
            limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Default 30.' },
        },
    },
    validate: (a, ctx) => validateWhen(ctx, a.dueFrom, 'dueFrom', true) ?? validateWhen(ctx, a.dueTo, 'dueTo', true),
    execute: async (a, ctx) => {
        const { tasks, projects } = ctx.port.getSnapshot();
        let projectId: string | undefined = a.projectId;
        if (!projectId && a.project) {
            const p = findProject(ctx, a.project);
            if ('error' in p) return fail(p.error);
            projectId = p.project.id;
        } else if (projectId) {
            const p = findProject(ctx, projectId);
            if ('error' in p) return fail(p.error);
            projectId = p.project.id;
        }
        const status = a.status ?? 'open';
        const today = toLocalDay(ctx.now);
        const needle = typeof a.search === 'string' ? a.search.toLowerCase() : '';
        const ctxFilter = a.context ? normContexts([a.context])[0].toLowerCase() : '';
        const tagFilter = a.tag ? normTags([a.tag])[0].toLowerCase() : '';
        const rows = tasks.filter(isLive).filter((t) => {
            if (status === 'open') { if (t.status === 'done' || t.status === 'archived' || t.status === 'reference') return false; }
            else if (status !== 'all' && t.status !== status) return false;
            if (projectId && t.projectId !== projectId) return false;
            if (a.priority && t.priority !== a.priority) return false;
            if (ctxFilter && !(t.contexts ?? []).some((c) => c.toLowerCase() === ctxFilter)) return false;
            if (tagFilter && !(t.tags ?? []).some((c) => c.toLowerCase() === tagFilter)) return false;
            if (needle && !`${t.title} ${t.description ?? ''}`.toLowerCase().includes(needle)) return false;
            const day = dayKeyOf(t.dueDate);
            if (a.overdue && !(day && day < today)) return false;
            if (a.dueFrom && !(day && day >= String(a.dueFrom).slice(0, 10))) return false;
            if (a.dueTo && !(day && day <= String(a.dueTo).slice(0, 10))) return false;
            return true;
        });
        const prio = { urgent: 0, high: 1, medium: 2, low: 3 } as Record<string, number>;
        rows.sort((x, y) => (x.dueDate ?? '9999').localeCompare(y.dueDate ?? '9999') || (prio[x.priority ?? ''] ?? 4) - (prio[y.priority ?? ''] ?? 4));
        const limit = a.limit ?? 30;
        const lookup = createTaskLookup(tasks);
        return { ok: true, data: { total: rows.length, shown: Math.min(limit, rows.length), tasks: rows.slice(0, limit).map((t) => compact(t, projects, lookup)) } };
    },
};

const getTask: AssistantTool = {
    name: 'get_task',
    description: 'Get full details of one task (notes, checklist, tags).',
    mutating: false,
    parameters: { type: 'object', required: ['id'], properties: { id: idProp } },
    execute: async (a, ctx) => {
        const found = findTask(ctx, a.id);
        if ('error' in found) return fail(found.error);
        const t = found.task;
        const lookup = createTaskLookup(ctx.port.getSnapshot().tasks);
        const blockers = getBlockers(t, lookup);
        return {
            ok: true,
            data: {
                ...compact(t, ctx.port.getSnapshot().projects, lookup),
                fullId: t.id,
                ...(blockers.length ? { blockedBy: blockers.map((b) => ({ id: shortId(b.id), title: b.title, status: b.status, blocking: isBlockerOpen(b) })) } : {}),
                notes: t.description,
                tags: t.tags,
                checklist: t.checklist?.map((c) => ({ title: c.title, done: c.isCompleted })),
                reminder: t.reminderPolicy,
            },
        };
    },
};

const addTask: AssistantTool = {
    name: 'add_task',
    description: 'Create a task. Use dueDate for the deadline, startTime for when to start/schedule, remind=true to get a reminder at the due time.',
    mutating: true,
    parameters: {
        type: 'object',
        required: ['title'],
        properties: {
            title: { type: 'string', minLength: 1, maxLength: 300 },
            status: { type: 'string', enum: STATUSES.filter((s) => s !== 'done') },
            dueDate: dateProp('Deadline'),
            startTime: dateProp('Scheduled start'),
            remind: { type: 'boolean', description: 'Send a reminder. Requires dueDate (or startTime) with a time.' },
            reminderMinutesBefore: { type: 'integer', minimum: 0, maximum: 10080, description: 'Remind this many minutes before dueDate (0 = at due time).' },
            priority: { type: 'string', enum: PRIORITIES },
            projectId: { type: 'string', description: 'Project id or exact title.' },
            areaId: { type: 'string', description: 'Area id or name, for a task that belongs to an area but no project. Route by the area description, keywords and people.' },
            reason: reasonProp,
            contexts: { type: 'array', items: { type: 'string', minLength: 1 }, maxItems: 10 },
            tags: { type: 'array', items: { type: 'string', minLength: 1 }, maxItems: 10 },
            description: { type: 'string', maxLength: 4000, description: 'Notes.' },
            checklist: { type: 'array', items: { type: 'string', minLength: 1 }, maxItems: 30 },
            blockedBy: blockedByProp,
        },
    },
    validate: (a, ctx) => {
        const bad = validateWhen(ctx, a.dueDate, 'dueDate') ?? validateWhen(ctx, a.startTime, 'startTime');
        if (bad) return bad;
        if (a.dueDate && a.startTime && normWhen(ctx, a.startTime) > normWhen(ctx, a.dueDate)) return 'startTime must not be after dueDate.';
        if ((a.remind || a.reminderMinutesBefore !== undefined) && !(hasTimeOf(a.dueDate) || hasTimeOf(a.startTime))) {
            return 'A reminder needs a time: give dueDate (or startTime) as "YYYY-MM-DDTHH:mm". Ask the user for the time if they did not say one.';
        }
        if (a.projectId) { const p = findProject(ctx, a.projectId); if ('error' in p) return p.error; }
        if (a.areaId) {
            if (a.projectId) return 'Pass projectId or areaId, not both (a project already belongs to its area).';
            const ar = findArea(ctx, a.areaId); if ('error' in ar) return ar.error;
        }
        if (a.blockedBy !== undefined) { const blockers = resolveBlockers(ctx, a.blockedBy); if ('error' in blockers) return blockers.error; }
        return null;
    },
    execute: async (a, ctx) => {
        const props: Partial<Task> = {};
        const blockers = a.blockedBy !== undefined ? resolveBlockers(ctx, a.blockedBy) : undefined;
        if (blockers && 'tasks' in blockers && blockers.tasks.length > 0) props.blockedByTaskIds = blockers.tasks.map((t) => t.id);
        const project = a.projectId ? (findProject(ctx, a.projectId) as { project: Project }).project : undefined;
        const area = a.areaId ? (findArea(ctx, a.areaId) as { area: Area }).area : undefined;
        if (project) props.projectId = project.id;
        if (area) props.areaId = area.id;
        if (a.dueDate) props.dueDate = normWhen(ctx, a.dueDate);
        if (a.startTime) props.startTime = normWhen(ctx, a.startTime);
        if (a.priority) props.priority = a.priority as TaskPriority;
        if (a.contexts?.length) props.contexts = dedupe(normContexts(a.contexts));
        if (a.tags?.length) props.tags = dedupe(normTags(a.tags));
        if (a.description) props.description = a.description;
        if (a.checklist?.length) props.checklist = checklistFrom(a.checklist);
        props.status = (a.status as TaskStatus) ?? (project || area || props.dueDate || props.startTime ? 'next' : 'inbox');
        if (a.remind || a.reminderMinutesBefore !== undefined) {
            props.reminderPolicy = 'send';
            if (a.reminderMinutesBefore) props.dueReminderLeadMinutes = a.reminderMinutesBefore;
        }
        const res = await ctx.port.addTask(a.title, props);
        if (!res.success || !res.id) return fail(res.error ?? 'Could not create the task');
        const when = props.dueDate ?? props.startTime;
        const reason = project || area ? reasonOf(a.reason) : undefined;
        const blockedNote = props.blockedByTaskIds?.length ? ' · waits for other tasks' : '';
        const where = project ? ` · ${project.title}` : area ? ` · ${area.name}` : '';
        return {
            ok: true,
            data: { id: shortId(res.id), title: a.title, status: props.status, due: props.dueDate, start: props.startTime, reminder: props.reminderPolicy === 'send', ...(project ? { project: project.title } : {}), ...(area ? { area: area.name } : {}) },
            change: {
                ...(reason ? { reason } : {}),
                label: `Added '${a.title}'${where}${when ? ` · ${formatWhen(when)}` : ''}${props.reminderPolicy === 'send' ? ' · reminder' : ''}${blockedNote}`,
                undoOps: [{ kind: 'deleteTask', taskId: res.id }],
                changes: [{ taskId: res.id, title: a.title, before: {}, after: { ...props } }],
            },
        };
    },
};

const updateTask: AssistantTool = {
    name: 'update_task',
    description: 'Edit one task. Pass null to clear dueDate/startTime/priority/projectId. For completing use complete_task; for deleting use delete_task.',
    mutating: true,
    parameters: {
        type: 'object',
        required: ['id'],
        properties: {
            id: idProp,
            title: { type: 'string', minLength: 1, maxLength: 300 },
            status: { type: 'string', enum: STATUSES.filter((s) => s !== 'done') },
            dueDate: { ...dateProp('Deadline (null clears)'), nullable: true },
            startTime: { ...dateProp('Scheduled start (null clears)'), nullable: true },
            priority: { type: 'string', enum: PRIORITIES, nullable: true },
            projectId: { type: 'string', nullable: true, description: 'Project id or exact title; null removes from project.' },
            areaId: { type: 'string', nullable: true, description: 'Area id or name (moves the task out of its project into the area); null removes the area.' },
            reason: reasonProp,
            contexts: { type: 'array', items: { type: 'string', minLength: 1 }, maxItems: 10 },
            tags: { type: 'array', items: { type: 'string', minLength: 1 }, maxItems: 10 },
            description: { type: 'string', maxLength: 4000 },
            remind: { type: 'boolean', description: 'true = send reminders, false = skip them.' },
            blockedBy: { ...blockedByProp, nullable: true, description: `${blockedByProp.description} Replaces the current list; null clears it.` },
        },
    },
    validate: (a, ctx) => {
        const found = findTask(ctx, a.id);
        if ('error' in found) return found.error;
        if (Object.keys(a).length < 2) return 'Nothing to change: pass at least one field besides id.';
        const bad = validateWhen(ctx, a.dueDate, 'dueDate') ?? validateWhen(ctx, a.startTime, 'startTime');
        if (bad) return bad;
        if (a.remind === true) {
            const due = a.dueDate === undefined ? found.task.dueDate : a.dueDate;
            const start = a.startTime === undefined ? found.task.startTime : a.startTime;
            if (!(hasTimeOf(due) || hasTimeOf(start))) return 'A reminder needs a due/start time ("YYYY-MM-DDTHH:mm").';
        }
        if (typeof a.projectId === 'string') { const p = findProject(ctx, a.projectId); if ('error' in p) return p.error; }
        if (typeof a.areaId === 'string') {
            if (typeof a.projectId === 'string') return 'Pass projectId or areaId, not both (a project already belongs to its area).';
            const ar = findArea(ctx, a.areaId); if ('error' in ar) return ar.error;
        }
        if (Array.isArray(a.blockedBy)) { const blockers = resolveBlockers(ctx, a.blockedBy, found.task); if ('error' in blockers) return blockers.error; }
        return null;
    },
    execute: async (a, ctx) => {
        const task = (findTask(ctx, a.id) as { task: Task }).task;
        const updates: Record<string, unknown> = {};
        for (const key of ['title', 'status', 'priority', 'description'] as const) if (a[key] !== undefined) updates[key] = a[key] ?? undefined;
        if (a.dueDate !== undefined) updates.dueDate = a.dueDate === null ? undefined : normWhen(ctx, a.dueDate);
        if (a.startTime !== undefined) updates.startTime = a.startTime === null ? undefined : normWhen(ctx, a.startTime);
        if (a.projectId !== undefined) updates.projectId = a.projectId === null ? undefined : (findProject(ctx, a.projectId) as { project: Project }).project.id;
        if (a.areaId !== undefined) {
            updates.areaId = a.areaId === null ? undefined : (findArea(ctx, a.areaId) as { area: Area }).area.id;
            // Moving into an area takes the task out of its project (a project already has its own area).
            if (a.areaId !== null && task.projectId && a.projectId === undefined) { updates.projectId = undefined; updates.sectionId = undefined; }
        }
        if (a.contexts) updates.contexts = dedupe(normContexts(a.contexts));
        if (a.tags) updates.tags = dedupe(normTags(a.tags));
        if (a.remind !== undefined) updates.reminderPolicy = a.remind ? 'send' : 'skip';
        if (a.blockedBy !== undefined) {
            updates.blockedByTaskIds = Array.isArray(a.blockedBy)
                ? normalizeBlockedByTaskIds((resolveBlockers(ctx, a.blockedBy, task) as { tasks: Task[] }).tasks.map((t) => t.id), task.id)
                : undefined;
        }
        const r = await applyUpdate(ctx, task, updates as Partial<Task>);
        if ('error' in r) return fail(r.error!);
        const { projects, areas } = ctx.port.getSnapshot();
        const bits = Object.keys(updates).filter((k) => k !== 'sectionId').map((k) => {
            if (k === 'dueDate') return `due ${updates.dueDate ? formatWhen(updates.dueDate as string) : 'cleared'}`;
            if (k === 'projectId' && updates.projectId) return `→ ${projects.find((p) => p.id === updates.projectId)?.title ?? 'project'}`;
            if (k === 'areaId' && updates.areaId) return `→ ${areas.find((x) => x.id === updates.areaId)?.name ?? 'area'}`;
            if (k === 'blockedByTaskIds') return updates.blockedByTaskIds ? 'waits for other tasks' : 'no longer blocked';
            return k;
        });
        const routed = Boolean(updates.projectId || updates.areaId);
        const reason = routed ? reasonOf(a.reason) : undefined;
        return {
            ok: true,
            data: { id: shortId(task.id), updated: Object.keys(updates) },
            change: { ...(reason ? { reason } : {}), label: `Updated '${task.title}' · ${bits.join(', ')}`, undoOps: [r.undo!], changes: [r.change!] },
        };
    },
};

const completeTask: AssistantTool = {
    name: 'complete_task',
    description: 'Mark one task done. A task still waiting for other tasks needs user confirmation first.',
    mutating: true,
    parameters: { type: 'object', required: ['id'], properties: { id: idProp } },
    validate: (a, ctx) => {
        const f = findTask(ctx, a.id);
        if ('error' in f) return f.error;
        return f.task.status === 'done' ? `'${f.task.title}' is already done.` : null;
    },
    confirmation: (a, ctx) => {
        const { task } = findTask(ctx, a.id) as { task: Task };
        const open = getOpenBlockers(task, createTaskLookup(ctx.port.getSnapshot().tasks));
        if (open.length === 0) return null;
        const titles = open.slice(0, 3).map((blocker) => `'${blocker.title}'`).join(', ');
        return {
            reason: 'This task is still waiting for other tasks',
            summary: `Mark '${task.title}' done, even though it is waiting for ${titles}`,
            affectedTaskIds: [task.id],
        };
    },
    execute: async (a, ctx) => {
        const task = (findTask(ctx, a.id) as { task: Task }).task;
        const snap = snapshotFields(task, ['status', 'completedAt']);
        const res = await ctx.port.completeTask(task.id);
        if (!res.success) return fail(res.error ?? 'Could not complete the task');
        return {
            ok: true,
            data: { id: shortId(task.id), status: 'done' },
            change: {
                label: `Completed '${task.title}'`,
                undoOps: [{ kind: 'restoreFields', taskId: task.id, fields: snap.fields, clear: snap.clear }],
                changes: [{ taskId: task.id, title: task.title, before: snap.before, after: { status: 'done' } }],
            },
        };
    },
};

export const resolveIds = (ctx: ToolContext, ids: string[]): { tasks: Task[] } | { error: string } => {
    const tasks: Task[] = [];
    const bad: string[] = [];
    for (const id of ids) {
        const f = findTask(ctx, id);
        if ('error' in f) bad.push(id);
        else if (!tasks.some((t) => t.id === f.task.id)) tasks.push(f.task);
    }
    if (bad.length) return { error: `Unknown task id(s): ${bad.join(', ')}. Use list_tasks to find real ids; never guess ids.` };
    return { tasks };
};

const moveTasks: AssistantTool = {
    name: 'move_tasks',
    description: 'Bulk defer/move tasks: set one new dueDate, OR shift due dates by shiftDays, OR change status, OR move them into a project (projectId) or an area (areaId). Changes touching more than 3 tasks require user confirmation.',
    mutating: true,
    parameters: {
        type: 'object',
        required: ['ids'],
        properties: {
            ids: { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1, maxItems: 100 },
            dueDate: dateProp('Set this due date on all (time of day is kept if a task had one and you pass a date only)'),
            shiftDays: { type: 'integer', minimum: -365, maximum: 365, description: 'Shift existing due (and start) dates by N days; tasks without due date get today+N.' },
            status: { type: 'string', enum: STATUSES.filter((s) => s !== 'done') },
            projectId: { type: 'string', description: 'Move all into this project (id or exact title).' },
            areaId: { type: 'string', description: 'Move all into this area (id or name); they leave their projects.' },
            reason: reasonProp,
        },
    },
    validate: (a, ctx) => {
        const modes = ['dueDate', 'shiftDays', 'status', 'projectId', 'areaId'].filter((k) => a[k] !== undefined);
        if (modes.length !== 1) return 'Pass exactly one of dueDate, shiftDays, status, projectId or areaId.';
        const bad = validateWhen(ctx, a.dueDate, 'dueDate');
        if (bad) return bad;
        if (a.projectId) { const p = findProject(ctx, a.projectId); if ('error' in p) return p.error; }
        if (a.areaId) { const ar = findArea(ctx, a.areaId); if ('error' in ar) return ar.error; }
        const r = resolveIds(ctx, a.ids);
        return 'error' in r ? r.error : null;
    },
    confirmation: (a, ctx) => {
        const { tasks } = resolveIds(ctx, a.ids) as { tasks: Task[] };
        if (tasks.length <= BULK_CONFIRM_THRESHOLD) return null;
        const what = a.dueDate ? `due ${formatWhen(a.dueDate)}` : a.shiftDays !== undefined ? `shift ${a.shiftDays} day(s)`
            : a.projectId ? `to project ${(findProject(ctx, a.projectId) as { project: Project }).project.title}`
                : a.areaId ? `to area ${(findArea(ctx, a.areaId) as { area: Area }).area.name}` : `status ${a.status}`;
        return { reason: `Bulk change of ${tasks.length} tasks`, summary: `Move ${tasks.length} tasks: ${what}`, affectedTaskIds: tasks.map((t) => t.id) };
    },
    execute: async (a, ctx) => {
        const { tasks } = resolveIds(ctx, a.ids) as { tasks: Task[] };
        const undoOps: UndoOp[] = [];
        const changes: ChangeEntry['changes'] = [];
        const failures: string[] = [];
        const targetProject = a.projectId ? (findProject(ctx, a.projectId) as { project: Project }).project : undefined;
        const targetArea = a.areaId ? (findArea(ctx, a.areaId) as { area: Area }).area : undefined;
        for (const task of tasks) {
            const updates: Record<string, unknown> = {};
            if (a.status) updates.status = a.status;
            if (targetProject) { updates.projectId = targetProject.id; if (task.areaId) updates.areaId = undefined; }
            if (targetArea) {
                updates.areaId = targetArea.id;
                if (task.projectId) { updates.projectId = undefined; updates.sectionId = undefined; }
            }
            if (a.dueDate) {
                const v = normWhen(ctx, a.dueDate);
                updates.dueDate = !hasTimeOf(v) && hasTimeOf(task.dueDate) ? `${v}T${task.dueDate!.slice(11, 16)}` : v;
            }
            if (a.shiftDays !== undefined) {
                updates.dueDate = shiftWhen(task.dueDate, a.shiftDays, ctx.now);
                if (task.startTime) updates.startTime = shiftWhen(task.startTime, a.shiftDays, ctx.now);
            }
            const r = await applyUpdate(ctx, task, updates as Partial<Task>);
            if ('error' in r) failures.push(`${shortId(task.id)}: ${r.error}`);
            else { undoOps.push(r.undo!); changes.push(r.change!); }
        }
        if (changes.length === 0) return fail(`No task was changed. ${failures.join('; ')}`);
        const what = a.dueDate ? `due ${formatWhen(normWhen(ctx, a.dueDate))}` : a.shiftDays !== undefined ? `${a.shiftDays > 0 ? '+' : ''}${a.shiftDays}d`
            : targetProject ? `→ ${targetProject.title}` : targetArea ? `→ ${targetArea.name}` : `→ ${a.status}`;
        const reason = targetProject || targetArea ? reasonOf(a.reason) : undefined;
        return {
            ok: true,
            data: { moved: changes.length, failed: failures },
            change: { ...(reason ? { reason } : {}), label: `Moved ${changes.length} task${changes.length === 1 ? '' : 's'} · ${what}`, undoOps, changes },
        };
    },
};

const deleteTask: AssistantTool = {
    name: 'delete_task',
    description: 'Delete one task (moves it to trash). Always requires user confirmation.',
    mutating: true,
    parameters: { type: 'object', required: ['id'], properties: { id: idProp } },
    validate: (a, ctx) => { const f = findTask(ctx, a.id); return 'error' in f ? f.error : null; },
    confirmation: (a, ctx) => {
        const t = (findTask(ctx, a.id) as { task: Task }).task;
        return { reason: 'Deleting a task', summary: `Delete '${t.title}'`, affectedTaskIds: [t.id] };
    },
    execute: async (a, ctx) => {
        const task = (findTask(ctx, a.id) as { task: Task }).task;
        const res = await ctx.port.deleteTask(task.id);
        if (!res.success) return fail(res.error ?? 'Could not delete the task');
        return {
            ok: true,
            data: { deleted: shortId(task.id) },
            change: {
                label: `Deleted '${task.title}'`,
                undoOps: [{ kind: 'restoreTask', taskId: task.id }],
                changes: [{ taskId: task.id, title: task.title, before: { deleted: false }, after: { deleted: true } }],
            },
        };
    },
};

const listProjects: AssistantTool = {
    name: 'list_projects',
    description: 'List active projects with open task counts.',
    mutating: false,
    parameters: { type: 'object', properties: { includeInactive: { type: 'boolean' } } },
    execute: async (a, ctx) => {
        const { tasks, projects, areas } = ctx.port.getSnapshot();
        const rows = projects.filter((p) => !p.deletedAt && p.status !== 'archived' && (a.includeInactive || p.status === 'active'));
        return {
            ok: true,
            data: rows.slice(0, 60).map((p) => ({
                id: shortId(p.id),
                title: p.title,
                status: p.status,
                open: tasks.filter((t) => isActive(t) && t.projectId === p.id).length,
                ...(p.dueDate ? { due: p.dueDate } : {}),
                ...(p.areaId ? { area: areas.find((x) => x.id === p.areaId)?.name } : {}),
                ...(projectPurpose(p) ? { purpose: projectPurpose(p) } : {}),
            })),
        };
    },
};

const actionItem: JsonSchema = {
    type: 'object',
    required: ['title'],
    properties: {
        title: { type: 'string', minLength: 1, maxLength: 300 },
        dueDate: dateProp('Deadline'),
        startTime: dateProp('Scheduled start'),
        priority: { type: 'string', enum: PRIORITIES },
        description: { type: 'string', maxLength: 2000 },
    },
};

const addProject: AssistantTool = {
    name: 'add_project',
    description: 'Create a project, optionally with initial next actions (each can have its own dueDate). Use this to plan out a goal with a deadline.',
    mutating: true,
    parameters: {
        type: 'object',
        required: ['title'],
        properties: {
            title: { type: 'string', minLength: 1, maxLength: 200 },
            status: { type: 'string', enum: ['active', 'someday', 'waiting'] },
            dueDate: dateProp('Project deadline'),
            notes: { type: 'string', maxLength: 4000, description: 'The project\'s purpose / desired outcome (used as its purpose in AI routing).' },
            areaId: { type: 'string', description: 'Area id or name the project belongs to.' },
            reason: reasonProp,
            nextActions: { type: 'array', items: actionItem, maxItems: 25, description: 'Ordered first steps; strings are accepted as titles.' },
        },
    },
    validate: (a, ctx) => {
        const bad = validateWhen(ctx, a.dueDate, 'dueDate');
        if (bad) return bad;
        for (const [i, item] of (a.nextActions ?? []).entries()) {
            const e = validateWhen(ctx, item.dueDate, `nextActions[${i}].dueDate`) ?? validateWhen(ctx, item.startTime, `nextActions[${i}].startTime`);
            if (e) return e;
        }
        if (a.areaId) { const ar = findArea(ctx, a.areaId); if ('error' in ar) return ar.error; }
        const dup = ctx.port.getSnapshot().projects.find((p) => !p.deletedAt && p.title.toLowerCase() === a.title.toLowerCase());
        return dup ? `A project named "${dup.title}" already exists (${shortId(dup.id)}). Add tasks to it with add_task instead.` : null;
    },
    execute: async (a, ctx) => {
        const count = ctx.port.getSnapshot().projects.length;
        const props: Partial<Project> = { status: a.status ?? 'active' };
        if (a.dueDate) props.dueDate = normWhen(ctx, a.dueDate);
        if (a.notes) props.supportNotes = a.notes;
        const area = a.areaId ? (findArea(ctx, a.areaId) as { area: Area }).area : undefined;
        if (area) props.areaId = area.id;
        const reason = area ? reasonOf(a.reason) : undefined;
        const project = await ctx.port.addProject(a.title, PROJECT_COLORS[count % PROJECT_COLORS.length], props);
        if (!project) return fail('Could not create the project');
        const created: Array<{ id: string; title: string; due?: string }> = [];
        const errors: string[] = [];
        for (const item of a.nextActions ?? []) {
            const p: Partial<Task> = { projectId: project.id, status: 'next' };
            if (item.dueDate) p.dueDate = normWhen(ctx, item.dueDate);
            if (item.startTime) p.startTime = normWhen(ctx, item.startTime);
            if (item.priority) p.priority = item.priority;
            if (item.description) p.description = item.description;
            const r = await ctx.port.addTask(item.title, p);
            if (r.success && r.id) created.push({ id: r.id, title: item.title, due: p.dueDate });
            else errors.push(`${item.title}: ${r.error ?? 'failed'}`);
        }
        return {
            ok: true,
            data: { projectId: shortId(project.id), title: a.title, tasks: created.map((c) => ({ id: shortId(c.id), title: c.title, due: c.due })), failed: errors },
            change: {
                ...(reason ? { reason } : {}),
                label: `Created project '${a.title}'${area ? ` in ${area.name}` : ''}${created.length ? ` with ${created.length} task${created.length === 1 ? '' : 's'}` : ''}`,
                undoOps: [{ kind: 'deleteProject', projectId: project.id }],
                changes: [{ taskId: project.id, title: a.title, before: {}, after: { project: a.title, tasks: created.map((c) => c.title) } }],
            },
        };
    },
};

const breakdownTask: AssistantTool = {
    name: 'breakdown_task',
    description: 'Break a task into steps, as checklist items on the task (default) or as separate follow-up tasks (mode "tasks"). YOU supply the steps.',
    mutating: true,
    parameters: {
        type: 'object',
        required: ['id', 'steps'],
        properties: {
            id: idProp,
            steps: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 200 }, minItems: 1, maxItems: 20 },
            mode: { type: 'string', enum: ['checklist', 'tasks'] },
        },
    },
    validate: (a, ctx) => { const f = findTask(ctx, a.id); return 'error' in f ? f.error : null; },
    execute: async (a, ctx) => {
        const task = (findTask(ctx, a.id) as { task: Task }).task;
        if ((a.mode ?? 'checklist') === 'checklist') {
            const next = [...(task.checklist ?? []), ...checklistFrom(a.steps)];
            const r = await applyUpdate(ctx, task, { checklist: next });
            if ('error' in r) return fail(r.error!);
            return {
                ok: true,
                data: { id: shortId(task.id), added: a.steps.length },
                change: { label: `Added ${a.steps.length} checklist step${a.steps.length === 1 ? '' : 's'} to '${task.title}'`, undoOps: [r.undo!], changes: [{ ...r.change!, before: {}, after: { checklistAdded: a.steps } }] },
            };
        }
        const undoOps: UndoOp[] = [];
        const created: string[] = [];
        for (const step of a.steps as string[]) {
            const props: Partial<Task> = { status: task.status === 'inbox' ? 'inbox' : 'next', contexts: task.contexts, tags: task.tags };
            if (task.projectId) props.projectId = task.projectId;
            const r = await ctx.port.addTask(step, props);
            if (r.success && r.id) { undoOps.push({ kind: 'deleteTask', taskId: r.id }); created.push(step); }
        }
        if (!created.length) return fail('No follow-up task could be created');
        return {
            ok: true,
            data: { created: created.length },
            change: { label: `Broke '${task.title}' into ${created.length} task${created.length === 1 ? '' : 's'}`, undoOps, changes: [{ taskId: task.id, title: task.title, before: {}, after: { tasksAdded: created } }] },
        };
    },
};

const getTodayOverview: AssistantTool = {
    name: 'get_today_overview',
    description: 'Overview of what needs attention: overdue, due/starting today, upcoming 7 days, inbox count.',
    mutating: false,
    parameters: { type: 'object', properties: {} },
    execute: async (_a, ctx) => {
        const { tasks, projects } = ctx.port.getSnapshot();
        const today = toLocalDay(ctx.now);
        const horizon = toLocalDay(addLocalDays(startOfLocalDay(ctx.now), 7));
        const open = tasks.filter((t) => isActive(t) && t.status !== 'someday');
        const cap = (list: Task[]) => ({ count: list.length, tasks: list.slice(0, 15).map((t) => compact(t, projects)) });
        const byDue = (x: Task, y: Task) => (x.dueDate ?? '').localeCompare(y.dueDate ?? '');
        return {
            ok: true,
            data: {
                now: ctx.now.toISOString(),
                overdue: cap(open.filter((t) => { const d = dayKeyOf(t.dueDate); return !!d && d < today; }).sort(byDue)),
                today: cap(open.filter((t) => dayKeyOf(t.dueDate) === today || dayKeyOf(t.startTime) === today).sort(byDue)),
                upcoming: cap(open.filter((t) => { const d = dayKeyOf(t.dueDate); return !!d && d > today && d <= horizon; }).sort(byDue)),
                inbox: tasks.filter((t) => isLive(t) && t.status === 'inbox').length,
            },
        };
    },
};

export const CORE_TOOLS: AssistantTool[] = [
    listTasks, getTask, addTask, updateTask, completeTask, moveTasks, deleteTask,
    listProjects, addProject, breakdownTask, getTodayOverview,
];
