import type { Area, Project, Recurrence, Task, TaskStatus } from '../../types';
import { dayKeyOf, formatWhen, hasTimeOf, toLocalDay } from './dates';
import {
    BULK_CONFIRM_THRESHOLD, PRIORITIES, STATUSES, applyUpdate, compact, dateProp, dedupe, fail, findProject, findTask,
    idProp, isActive, isLive, normContexts, normTags, normWhen, shortId, validateWhen, findArea, reasonOf,
} from './tools';

export { findArea };
import type { AssistantTool, ChangeEntry, JsonSchema, ToolContext, UndoOp } from './types';

/** Stale = open task untouched for this many days. */
export const STALE_DAYS = 30;
const MAX_FOCUS = 5;
const strArr = (max = 100): JsonSchema => ({ type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1, maxItems: max });
const idsProp: JsonSchema = { ...strArr(100), description: 'Task ids from list_tasks. Unknown ids are dropped.' };

// ---- lookups ---------------------------------------------------------------------------

/** Resolve task ids, DROPPING unknown ones (reported back to the model). */
export function resolveIdsLenient(ctx: ToolContext, ids: string[]): { tasks: Task[]; dropped: string[] } {
    const tasks: Task[] = [];
    const dropped: string[] = [];
    for (const id of ids) {
        const f = findTask(ctx, id);
        if ('error' in f) dropped.push(id);
        else if (!tasks.some((t) => t.id === f.task.id)) tasks.push(f.task);
    }
    return { tasks, dropped };
}

const openTasksOf = (ctx: ToolContext, projectId: string) =>
    ctx.port.getSnapshot().tasks.filter((t) => isActive(t) && t.projectId === projectId);

async function applyProjectUpdate(ctx: ToolContext, project: Project, updates: Partial<Project>) {
    const keys = Object.keys(updates);
    const before: Record<string, unknown> = {};
    const fields: Record<string, unknown> = {};
    const clear: string[] = [];
    for (const k of keys) {
        const v = (project as unknown as Record<string, unknown>)[k];
        if (v === undefined) clear.push(k);
        else { fields[k] = v; before[k] = v; }
    }
    const res = await ctx.port.updateProject(project.id, updates);
    if (!res.success) return { error: res.error ?? 'Project update failed' };
    const after: Record<string, unknown> = {};
    for (const k of keys) after[k] = (updates as Record<string, unknown>)[k] ?? null;
    return {
        undo: { kind: 'restoreProjectFields', projectId: project.id, fields: fields as Partial<Project>, clear } as UndoOp,
        change: { taskId: project.id, title: project.title, before, after },
    };
}

type TaskAction = 'unassign' | 'move' | 'archive' | 'delete';

/** Re-home / archive / delete a project's tasks. Undo ops are returned in execution order. */
async function handleProjectTasks(ctx: ToolContext, tasks: Task[], action: TaskAction, targetId?: string) {
    const undoOps: UndoOp[] = [];
    const changes: ChangeEntry['changes'] = [];
    for (const task of tasks) {
        if (action === 'delete') {
            const r = await ctx.port.deleteTask(task.id);
            if (r.success) { undoOps.push({ kind: 'restoreTask', taskId: task.id }); changes.push({ taskId: task.id, title: task.title, before: { deleted: false }, after: { deleted: true } }); }
            continue;
        }
        const updates: Partial<Task> = action === 'move' ? { projectId: targetId } : action === 'archive' ? { status: 'archived' as TaskStatus } : { projectId: undefined };
        const r = await applyUpdate(ctx, task, updates);
        if (!('error' in r)) { undoOps.push(r.undo!); changes.push(r.change!); }
    }
    return { undoOps, changes };
}

const taskActionProp: JsonSchema = {
    type: 'string',
    enum: ['unassign', 'move', 'archive', 'delete'],
    description: 'What happens to the project\'s open tasks: unassign (keep them, no project), move (to moveToProjectId), archive, or delete. Required when the project has open tasks: ASK the user which one, offering these as options.',
};

function checkTaskAction(ctx: ToolContext, project: Project, a: Record<string, any>, allowed: TaskAction[]): string | null {
    const open = openTasksOf(ctx, project.id).length;
    if (open === 0) return null;
    if (!a.taskAction) return `'${project.title}' has ${open} open task(s). Ask the user what should happen to them, offering: ${allowed.join(', ')}. Then pass taskAction.`;
    if (!allowed.includes(a.taskAction)) return `taskAction must be one of ${allowed.join(', ')}.`;
    if (a.taskAction === 'move') {
        if (!a.moveToProjectId) return 'taskAction "move" needs moveToProjectId.';
        const t = findProject(ctx, a.moveToProjectId);
        if ('error' in t) return t.error;
        if (t.project.id === project.id) return 'moveToProjectId must be a different project.';
    }
    return null;
}

// ---- projects --------------------------------------------------------------------------

const updateProject: AssistantTool = {
    name: 'update_project',
    description: 'Edit a project: rename, colour, area, status (active/someday/waiting), notes, due date. Pass null to clear areaId/dueDate.',
    mutating: true,
    parameters: {
        type: 'object',
        required: ['id'],
        properties: {
            id: { type: 'string', minLength: 1, description: 'Project id (from list_projects) or exact title.' },
            title: { type: 'string', minLength: 1, maxLength: 200 },
            color: { type: 'string', description: 'Hex colour like "#3b82f6".' },
            areaId: { type: 'string', nullable: true, description: 'Area id or name; null removes the area.' },
            status: { type: 'string', enum: ['active', 'someday', 'waiting'] },
            notes: { type: 'string', maxLength: 4000 },
            dueDate: { ...dateProp('Project deadline (null clears)'), nullable: true },
        },
    },
    validate: (a, ctx) => {
        const p = findProject(ctx, a.id);
        if ('error' in p) return p.error;
        if (Object.keys(a).length < 2) return 'Nothing to change: pass at least one field besides id.';
        if (a.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(a.color)) return 'color must be a hex colour like "#3b82f6".';
        if (typeof a.areaId === 'string') { const ar = findArea(ctx, a.areaId); if ('error' in ar) return ar.error; }
        return validateWhen(ctx, a.dueDate, 'dueDate');
    },
    execute: async (a, ctx) => {
        const project = (findProject(ctx, a.id) as { project: Project }).project;
        const updates: Record<string, unknown> = {};
        if (a.title !== undefined) updates.title = a.title;
        if (a.color !== undefined) updates.color = a.color;
        if (a.status !== undefined) updates.status = a.status;
        if (a.notes !== undefined) updates.supportNotes = a.notes;
        if (a.dueDate !== undefined) updates.dueDate = a.dueDate === null ? undefined : normWhen(ctx, a.dueDate);
        if (a.areaId !== undefined) updates.areaId = a.areaId === null ? undefined : (findArea(ctx, a.areaId) as { area: Area }).area.id;
        const r = await applyProjectUpdate(ctx, project, updates as Partial<Project>);
        if ('error' in r) return fail(r.error!);
        const label = a.title && a.title !== project.title
            ? `Renamed project '${project.title}' to '${a.title}'`
            : `Updated project '${project.title}' · ${Object.keys(updates).join(', ')}`;
        return { ok: true, data: { id: shortId(project.id), updated: Object.keys(updates) }, change: { kind: 'project', label, undoOps: [r.undo!], changes: [r.change!] } };
    },
};

const archiveProject: AssistantTool = {
    name: 'archive_project',
    description: 'Archive a project (reversible). Always needs user confirmation. If it has open tasks, first ask the user what to do with them (unassign, move, archive) and pass taskAction.',
    mutating: true,
    parameters: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', minLength: 1 }, taskAction: { ...taskActionProp, enum: ['unassign', 'move', 'archive'] }, moveToProjectId: { type: 'string', description: 'Required for taskAction "move".' } },
    },
    validate: (a, ctx) => {
        const p = findProject(ctx, a.id);
        return 'error' in p ? p.error : checkTaskAction(ctx, p.project, a, ['unassign', 'move', 'archive']);
    },
    confirmation: (a, ctx) => {
        const p = (findProject(ctx, a.id) as { project: Project }).project;
        const open = openTasksOf(ctx, p.id);
        return { reason: 'Archiving a project', summary: `Archive project '${p.title}'${open.length ? ` (${open.length} open tasks: ${a.taskAction})` : ''}`, affectedTaskIds: open.map((t) => t.id) };
    },
    execute: async (a, ctx) => {
        const project = (findProject(ctx, a.id) as { project: Project }).project;
        const open = openTasksOf(ctx, project.id);
        const target = a.moveToProjectId ? (findProject(ctx, a.moveToProjectId) as { project: Project }).project.id : undefined;
        const moved = open.length ? await handleProjectTasks(ctx, open, a.taskAction, target) : { undoOps: [], changes: [] };
        // 'archive' tasks with the project: the store archives them when the project is archived.
        const r = await applyProjectUpdate(ctx, project, { status: 'archived' });
        if ('error' in r) return fail(r.error!);
        return {
            ok: true,
            data: { archived: shortId(project.id), tasks: open.length },
            change: { kind: 'project', label: `Archived project '${project.title}'${open.length ? ` · ${open.length} tasks ${a.taskAction === 'move' ? 'moved' : a.taskAction === 'unassign' ? 'unassigned' : 'archived'}` : ''}`, undoOps: [r.undo!, ...moved.undoOps].reverse(), changes: [r.change!, ...moved.changes] },
        };
    },
};

const deleteProject: AssistantTool = {
    name: 'delete_project',
    description: 'Delete a project (to trash). Always needs user confirmation. If it has open tasks, first ask the user what to do with them (unassign, move, archive, delete) and pass taskAction.',
    mutating: true,
    parameters: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', minLength: 1 }, taskAction: taskActionProp, moveToProjectId: { type: 'string', description: 'Required for taskAction "move".' } },
    },
    validate: (a, ctx) => {
        const p = findProject(ctx, a.id);
        return 'error' in p ? p.error : checkTaskAction(ctx, p.project, a, ['unassign', 'move', 'archive', 'delete']);
    },
    confirmation: (a, ctx) => {
        const p = (findProject(ctx, a.id) as { project: Project }).project;
        const open = openTasksOf(ctx, p.id);
        return { reason: 'Deleting a project', summary: `Delete project '${p.title}'${open.length ? ` (${open.length} open tasks: ${a.taskAction})` : ''}`, affectedTaskIds: open.map((t) => t.id) };
    },
    execute: async (a, ctx) => {
        const project = (findProject(ctx, a.id) as { project: Project }).project;
        const open = openTasksOf(ctx, project.id);
        const target = a.moveToProjectId ? (findProject(ctx, a.moveToProjectId) as { project: Project }).project.id : undefined;
        // Re-home every live task (incl. done) unless the user chose to delete them, so the store's cascade cannot trash them silently.
        const all = ctx.port.getSnapshot().tasks.filter((t) => isLive(t) && t.projectId === project.id);
        const moved = all.length
            ? await handleProjectTasks(ctx, all, a.taskAction === 'delete' ? 'delete' : a.taskAction === 'move' ? 'move' : 'unassign', target)
            : { undoOps: [], changes: [] };
        if (a.taskAction === 'archive') {
            for (const t of open) {
                const r = await applyUpdate(ctx, { ...t, projectId: undefined } as Task, { status: 'archived' as TaskStatus });
                if (!('error' in r)) { moved.undoOps.push(r.undo!); moved.changes.push(r.change!); }
            }
        }
        const res = await ctx.port.deleteProject(project.id);
        if (!res.success) return fail(res.error ?? 'Could not delete the project');
        return {
            ok: true,
            data: { deleted: shortId(project.id), tasks: open.length },
            change: {
                kind: 'project', label: `Deleted project '${project.title}'${open.length ? ` · ${open.length} tasks ${a.taskAction}` : ''}`,
                undoOps: [...moved.undoOps, { kind: 'restoreProject', projectId: project.id } as UndoOp].reverse(),
                changes: [{ taskId: project.id, title: project.title, before: { deleted: false }, after: { deleted: true } }, ...moved.changes],
            },
        };
    },
};

const mergeProjects: AssistantTool = {
    name: 'merge_projects',
    description: 'Merge project A (source) into B (target): moves all of A\'s tasks to B, then removes A. Needs user confirmation; undoable.',
    mutating: true,
    parameters: { type: 'object', required: ['sourceId', 'targetId'], properties: { sourceId: { type: 'string', minLength: 1 }, targetId: { type: 'string', minLength: 1 } } },
    validate: (a, ctx) => {
        const s = findProject(ctx, a.sourceId);
        if ('error' in s) return s.error;
        const t = findProject(ctx, a.targetId);
        if ('error' in t) return t.error;
        return s.project.id === t.project.id ? 'Source and target are the same project.' : null;
    },
    confirmation: (a, ctx) => {
        const s = (findProject(ctx, a.sourceId) as { project: Project }).project;
        const t = (findProject(ctx, a.targetId) as { project: Project }).project;
        const tasks = ctx.port.getSnapshot().tasks.filter((x) => isLive(x) && x.projectId === s.id);
        return { reason: 'Merging projects', summary: `Merge '${s.title}' into '${t.title}' (${tasks.length} tasks move)`, affectedTaskIds: tasks.map((x) => x.id) };
    },
    execute: async (a, ctx) => {
        const s = (findProject(ctx, a.sourceId) as { project: Project }).project;
        const t = (findProject(ctx, a.targetId) as { project: Project }).project;
        const tasks = ctx.port.getSnapshot().tasks.filter((x) => isLive(x) && x.projectId === s.id);
        const moved = await handleProjectTasks(ctx, tasks, 'move', t.id);
        const res = await ctx.port.deleteProject(s.id);
        if (!res.success) return fail(res.error ?? 'Could not remove the merged project');
        return {
            ok: true,
            data: { merged: shortId(s.id), into: shortId(t.id), tasksMoved: moved.changes.length },
            change: {
                kind: 'merge', label: `Merged project '${s.title}' into '${t.title}' · ${moved.changes.length} tasks moved`,
                undoOps: [...moved.undoOps, { kind: 'restoreProject', projectId: s.id } as UndoOp].reverse(),
                changes: [{ taskId: s.id, title: s.title, before: { deleted: false }, after: { mergedInto: t.title } }, ...moved.changes],
            },
        };
    },
};

// ---- areas -----------------------------------------------------------------------------

const deleteArea: AssistantTool = {
    name: 'delete_area',
    description: 'Delete an area (projects/tasks are kept). Always needs user confirmation.',
    mutating: true,
    parameters: { type: 'object', required: ['id'], properties: { id: { type: 'string', minLength: 1 } } },
    validate: (a, ctx) => { const f = findArea(ctx, a.id); return 'error' in f ? f.error : null; },
    confirmation: (a, ctx) => {
        const area = (findArea(ctx, a.id) as { area: Area }).area;
        const n = ctx.port.getSnapshot().projects.filter((p) => !p.deletedAt && p.areaId === area.id).length;
        return { reason: 'Deleting an area', summary: `Delete area '${area.name}'${n ? ` (${n} projects lose their area)` : ''}`, affectedTaskIds: [] };
    },
    execute: async (a, ctx) => {
        const area = (findArea(ctx, a.id) as { area: Area }).area;
        const res = await ctx.port.deleteArea(area.id);
        if (!res.success) return fail(res.error ?? 'Could not delete the area');
        return {
            ok: true, data: { deleted: shortId(area.id) },
            change: { kind: 'area', label: `Deleted area '${area.name}'`, undoOps: [{ kind: 'restoreArea', areaId: area.id }], changes: [{ taskId: area.id, title: area.name, before: { deleted: false }, after: { deleted: true } }] },
        };
    },
};

const assignProjectToArea: AssistantTool = {
    name: 'assign_project_to_area',
    description: 'Put a project into an area (areaId null removes it from its area).',
    mutating: true,
    parameters: { type: 'object', required: ['projectId', 'areaId'], properties: { projectId: { type: 'string', minLength: 1 }, areaId: { type: 'string', nullable: true, description: 'Area id or name, or null.' }, reason: { type: 'string', maxLength: 160, description: 'Short why (at most 12 words), shown to the user.' } } },
    validate: (a, ctx) => {
        const p = findProject(ctx, a.projectId);
        if ('error' in p) return p.error;
        if (typeof a.areaId === 'string') { const ar = findArea(ctx, a.areaId); if ('error' in ar) return ar.error; }
        return null;
    },
    execute: async (a, ctx) => {
        const project = (findProject(ctx, a.projectId) as { project: Project }).project;
        const area = a.areaId ? (findArea(ctx, a.areaId) as { area: Area }).area : undefined;
        const r = await applyProjectUpdate(ctx, project, { areaId: area?.id });
        if ('error' in r) return fail(r.error!);
        const reason = area ? reasonOf(a.reason) : undefined;
        return { ok: true, data: { project: shortId(project.id), area: area?.name ?? null }, change: { ...(reason ? { reason } : {}), kind: 'project', label: area ? `Moved project '${project.title}' to area '${area.name}'` : `Removed project '${project.title}' from its area`, undoOps: [r.undo!], changes: [r.change!] } };
    },
};

// ---- tags / contexts -------------------------------------------------------------------

const tagFor = (kind: string | undefined, name: string) => (kind === 'context' ? normContexts([name])[0] : normTags([name])[0]);
const tagKindProp: JsonSchema = { type: 'string', enum: ['tag', 'context'], description: 'tag (#name, default) or context (@name).' };
const fieldFor = (kind?: string): 'tags' | 'contexts' => (kind === 'context' ? 'contexts' : 'tags');

const listTags: AssistantTool = {
    name: 'list_tags',
    description: 'List tags (#) and contexts (@) in use with the number of open tasks using each.',
    mutating: false,
    parameters: { type: 'object', properties: {} },
    execute: async (_a, ctx) => {
        const tags = new Map<string, number>(); const contexts = new Map<string, number>();
        for (const t of ctx.port.getSnapshot().tasks.filter(isActive)) {
            for (const x of t.tags ?? []) tags.set(x, (tags.get(x) ?? 0) + 1);
            for (const x of t.contexts ?? []) contexts.set(x, (contexts.get(x) ?? 0) + 1);
        }
        const rows = (m: Map<string, number>) => [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, 60).map(([name, open]) => ({ name, open }));
        return { ok: true, data: { tags: rows(tags), contexts: rows(contexts) } };
    },
};

async function mutateTaskLists(ctx: ToolContext, tasks: Task[], build: (t: Task) => Partial<Task> | null) {
    const undoOps: UndoOp[] = []; const changes: ChangeEntry['changes'] = [];
    for (const task of tasks) {
        const updates = build(task);
        if (!updates) continue;
        const r = await applyUpdate(ctx, task, updates);
        if (!('error' in r)) { undoOps.push(r.undo!); changes.push(r.change!); }
    }
    return { undoOps, changes };
}

const tagTasks: AssistantTool = {
    name: 'tag_tasks',
    description: 'Add and/or remove tags (or contexts) on many tasks at once. Changes touching more than 3 tasks need confirmation.',
    mutating: true,
    parameters: { type: 'object', required: ['ids'], properties: { ids: idsProp, add: { ...strArr(10), minItems: 0 }, remove: { ...strArr(10), minItems: 0 }, kind: tagKindProp } },
    validate: (a, ctx) => {
        if (!(a.add?.length || a.remove?.length)) return 'Pass add and/or remove.';
        return resolveIdsLenient(ctx, a.ids).tasks.length ? null : `None of the ids are known tasks (${a.ids.join(', ')}). Use list_tasks.`;
    },
    confirmation: (a, ctx) => {
        const { tasks } = resolveIdsLenient(ctx, a.ids);
        return tasks.length > BULK_CONFIRM_THRESHOLD ? { reason: `Bulk change of ${tasks.length} tasks`, summary: `Update tags on ${tasks.length} tasks`, affectedTaskIds: tasks.map((t) => t.id) } : null;
    },
    execute: async (a, ctx) => {
        const { tasks, dropped } = resolveIdsLenient(ctx, a.ids);
        const field = fieldFor(a.kind);
        const add = (a.add ?? []).map((n: string) => tagFor(a.kind, n)); const rem = new Set((a.remove ?? []).map((n: string) => tagFor(a.kind, n).toLowerCase()));
        const r = await mutateTaskLists(ctx, tasks, (t) => {
            const cur = (t[field] ?? []) as string[];
            const next = dedupe([...cur.filter((x) => !rem.has(x.toLowerCase())), ...add]);
            return next.length === cur.length && next.every((x, i) => x === cur[i]) ? null : { [field]: next } as Partial<Task>;
        });
        if (!r.changes.length) return { ok: true, data: { changed: 0, dropped } };
        const what = [add.length ? `+${add.join(' ')}` : '', rem.size ? `-${[...rem].join(' ')}` : ''].filter(Boolean).join(' ');
        return { ok: true, data: { changed: r.changes.length, dropped }, change: { kind: 'tag', label: `Tagged ${r.changes.length} task${r.changes.length === 1 ? '' : 's'} · ${what}`, undoOps: r.undoOps, changes: r.changes } };
    },
};

const renameTag: AssistantTool = {
    name: 'rename_tag',
    description: 'Rename a tag or context on all tasks that use it.',
    mutating: true,
    parameters: { type: 'object', required: ['from', 'to'], properties: { from: { type: 'string', minLength: 1 }, to: { type: 'string', minLength: 1 }, kind: tagKindProp } },
    validate: (a, ctx) => {
        const from = tagFor(a.kind, a.from); const to = tagFor(a.kind, a.to);
        if (from.toLowerCase() === to.toLowerCase()) return 'from and to are the same.';
        const field = fieldFor(a.kind);
        return ctx.port.getSnapshot().tasks.some((t) => isLive(t) && ((t[field] ?? []) as string[]).some((x) => x.toLowerCase() === from.toLowerCase())) ? null : `No task uses ${from}. Use list_tags.`;
    },
    execute: async (a, ctx) => {
        const field = fieldFor(a.kind); const from = tagFor(a.kind, a.from).toLowerCase(); const to = tagFor(a.kind, a.to);
        const tasks = ctx.port.getSnapshot().tasks.filter((t) => isLive(t) && ((t[field] ?? []) as string[]).some((x) => x.toLowerCase() === from));
        const r = await mutateTaskLists(ctx, tasks, (t) => ({ [field]: dedupe(((t[field] ?? []) as string[]).map((x) => (x.toLowerCase() === from ? to : x))) }) as Partial<Task>);
        if (!r.changes.length) return fail('No task could be updated');
        return { ok: true, data: { renamed: r.changes.length }, change: { kind: 'tag', label: `Renamed ${tagFor(a.kind, a.from)} to ${to} on ${r.changes.length} task${r.changes.length === 1 ? '' : 's'}`, undoOps: r.undoOps, changes: r.changes } };
    },
};

const deleteTag: AssistantTool = {
    name: 'delete_tag',
    description: 'Remove a tag or context from every task that uses it. Always needs user confirmation.',
    mutating: true,
    parameters: { type: 'object', required: ['name'], properties: { name: { type: 'string', minLength: 1 }, kind: tagKindProp } },
    validate: (a, ctx) => {
        const field = fieldFor(a.kind); const n = tagFor(a.kind, a.name).toLowerCase();
        return ctx.port.getSnapshot().tasks.some((t) => isLive(t) && ((t[field] ?? []) as string[]).some((x) => x.toLowerCase() === n)) ? null : `No task uses ${tagFor(a.kind, a.name)}. Use list_tags.`;
    },
    confirmation: (a, ctx) => {
        const field = fieldFor(a.kind); const n = tagFor(a.kind, a.name).toLowerCase();
        const tasks = ctx.port.getSnapshot().tasks.filter((t) => isLive(t) && ((t[field] ?? []) as string[]).some((x) => x.toLowerCase() === n));
        return { reason: 'Removing a tag', summary: `Remove ${tagFor(a.kind, a.name)} from ${tasks.length} task${tasks.length === 1 ? '' : 's'}`, affectedTaskIds: tasks.map((t) => t.id) };
    },
    execute: async (a, ctx) => {
        const field = fieldFor(a.kind); const n = tagFor(a.kind, a.name).toLowerCase();
        const tasks = ctx.port.getSnapshot().tasks.filter((t) => isLive(t) && ((t[field] ?? []) as string[]).some((x) => x.toLowerCase() === n));
        const r = await mutateTaskLists(ctx, tasks, (t) => ({ [field]: ((t[field] ?? []) as string[]).filter((x) => x.toLowerCase() !== n) }) as Partial<Task>);
        if (!r.changes.length) return fail('No task could be updated');
        return { ok: true, data: { removedFrom: r.changes.length }, change: { kind: 'tag', label: `Removed ${tagFor(a.kind, a.name)} from ${r.changes.length} task${r.changes.length === 1 ? '' : 's'}`, undoOps: r.undoOps, changes: r.changes } };
    },
};

// ---- bulk + cleanup --------------------------------------------------------------------

const bulkUpdate: AssistantTool = {
    name: 'bulk_update_tasks',
    description: 'Change many tasks at once: priority, dueDate, status, project, add/remove tags. One call = one undo group. More than 3 tasks needs user confirmation. Unknown ids are dropped.',
    mutating: true,
    parameters: {
        type: 'object',
        required: ['ids'],
        properties: {
            ids: idsProp,
            priority: { type: 'string', enum: PRIORITIES, nullable: true },
            dueDate: { ...dateProp('Due date for all (null clears)'), nullable: true },
            status: { type: 'string', enum: STATUSES.filter((s) => s !== 'done') },
            projectId: { type: 'string', nullable: true, description: 'Project id or exact title; null removes from project.' },
            addTags: { ...strArr(10), minItems: 0 },
            removeTags: { ...strArr(10), minItems: 0 },
        },
    },
    validate: (a, ctx) => {
        if (!['priority', 'dueDate', 'status', 'projectId', 'addTags', 'removeTags'].some((k) => a[k] !== undefined)) return 'Nothing to change.';
        const bad = validateWhen(ctx, a.dueDate, 'dueDate');
        if (bad) return bad;
        if (typeof a.projectId === 'string') { const p = findProject(ctx, a.projectId); if ('error' in p) return p.error; }
        return resolveIdsLenient(ctx, a.ids).tasks.length ? null : `None of the ids are known tasks (${a.ids.join(', ')}). Use list_tasks.`;
    },
    confirmation: (a, ctx) => {
        const { tasks } = resolveIdsLenient(ctx, a.ids);
        return tasks.length > BULK_CONFIRM_THRESHOLD ? { reason: `Bulk change of ${tasks.length} tasks`, summary: `Update ${tasks.length} tasks: ${describeBulk(a)}`, affectedTaskIds: tasks.map((t) => t.id) } : null;
    },
    execute: async (a, ctx) => {
        const { tasks, dropped } = resolveIdsLenient(ctx, a.ids);
        const projectId = typeof a.projectId === 'string' ? (findProject(ctx, a.projectId) as { project: Project }).project.id : undefined;
        const add = normTags(a.addTags); const rem = new Set(normTags(a.removeTags).map((x) => x.toLowerCase()));
        const r = await mutateTaskLists(ctx, tasks, (t) => {
            const u: Record<string, unknown> = {};
            if (a.priority !== undefined) u.priority = a.priority ?? undefined;
            if (a.dueDate !== undefined) u.dueDate = a.dueDate === null ? undefined : normWhen(ctx, a.dueDate);
            if (a.status !== undefined) u.status = a.status;
            if (a.projectId !== undefined) u.projectId = projectId;
            if (add.length || rem.size) u.tags = dedupe([...(t.tags ?? []).filter((x) => !rem.has(x.toLowerCase())), ...add]);
            return u as Partial<Task>;
        });
        if (!r.changes.length) return fail('No task was changed.');
        return { ok: true, data: { changed: r.changes.length, dropped }, change: { kind: 'task', label: `Updated ${r.changes.length} task${r.changes.length === 1 ? '' : 's'} · ${describeBulk(a)}`, undoOps: r.undoOps, changes: r.changes } };
    },
};

function describeBulk(a: Record<string, any>): string {
    const bits: string[] = [];
    if (a.priority !== undefined) bits.push(a.priority ? `priority ${a.priority}` : 'priority cleared');
    if (a.dueDate !== undefined) bits.push(a.dueDate ? `due ${formatWhen(a.dueDate)}` : 'due cleared');
    if (a.status) bits.push(`status ${a.status}`);
    if (a.projectId !== undefined) bits.push(a.projectId ? 'project changed' : 'removed from project');
    if (a.addTags?.length) bits.push(`+${normTags(a.addTags).join(' ')}`);
    if (a.removeTags?.length) bits.push(`-${normTags(a.removeTags).join(' ')}`);
    return bits.join(', ');
}

const STOP = new Set(['the', 'a', 'an', 'to', 'of', 'for', 'and', 'with', 'my', 'on', 'in']);
const tokens = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w && !STOP.has(w));

/** Pure, non-AI similarity: token overlap (Jaccard) or one title containing the other. */
export function titleSimilarity(a: string, b: string): number {
    const ta = tokens(a); const tb = tokens(b);
    if (!ta.length || !tb.length) return 0;
    const na = ta.join(' '); const nb = tb.join(' ');
    if (na === nb) return 1;
    if (Math.min(na.length, nb.length) >= 8 && (na.includes(nb) || nb.includes(na))) return 0.9;
    const sa = new Set(ta); const sb = new Set(tb);
    const inter = [...sa].filter((x) => sb.has(x)).length;
    return inter / (sa.size + sb.size - inter);
}

export function groupDuplicates<T extends { id: string; title: string }>(items: T[], threshold = 0.7): T[][] {
    const parent = items.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < items.length; i += 1) for (let j = i + 1; j < items.length; j += 1) {
        if (titleSimilarity(items[i].title, items[j].title) >= threshold) parent[find(i)] = find(j);
    }
    const groups = new Map<number, T[]>();
    items.forEach((it, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), it]));
    return [...groups.values()].filter((g) => g.length > 1);
}

const findDuplicates: AssistantTool = {
    name: 'find_duplicates',
    description: 'Find likely duplicate open tasks (or projects) by title similarity. Returns candidate groups; you then decide, ask the user, and use merge_tasks / merge_projects.',
    mutating: false,
    parameters: { type: 'object', properties: { scope: { type: 'string', enum: ['tasks', 'projects'] }, threshold: { type: 'number', minimum: 0.5, maximum: 1, description: 'Default 0.7.' } } },
    execute: async (a, ctx) => {
        const { tasks, projects } = ctx.port.getSnapshot();
        const th = a.threshold ?? 0.7;
        if (a.scope === 'projects') {
            const live = projects.filter((p) => !p.deletedAt && p.status !== 'archived');
            return { ok: true, data: { groups: groupDuplicates(live, th).slice(0, 10).map((g) => g.map((p) => ({ id: shortId(p.id), title: p.title, open: tasks.filter((t) => isActive(t) && t.projectId === p.id).length }))) } };
        }
        const groups = groupDuplicates(tasks.filter(isActive), th);
        return { ok: true, data: { total: groups.length, groups: groups.slice(0, 10).map((g) => g.slice(0, 6).map((t) => compact(t, projects))) } };
    },
};

const mergeTasks: AssistantTool = {
    name: 'merge_tasks',
    description: 'Merge a duplicate task into the one to keep: notes, checklist, tags and the earlier due date are combined onto keepId, then removeId is deleted (trash). Needs user confirmation; undoable.',
    mutating: true,
    parameters: { type: 'object', required: ['keepId', 'removeId'], properties: { keepId: idProp, removeId: idProp } },
    validate: (a, ctx) => {
        const k = findTask(ctx, a.keepId); if ('error' in k) return k.error;
        const r = findTask(ctx, a.removeId); if ('error' in r) return r.error;
        return k.task.id === r.task.id ? 'keepId and removeId are the same task.' : null;
    },
    confirmation: (a, ctx) => {
        const k = (findTask(ctx, a.keepId) as { task: Task }).task; const r = (findTask(ctx, a.removeId) as { task: Task }).task;
        return { reason: 'Merging tasks', summary: `Merge '${r.title}' into '${k.title}'`, affectedTaskIds: [k.id, r.id] };
    },
    execute: async (a, ctx) => {
        const k = (findTask(ctx, a.keepId) as { task: Task }).task; const r = (findTask(ctx, a.removeId) as { task: Task }).task;
        const updates: Partial<Task> = {};
        const notes = [k.description, r.description ? (k.description ? `Merged from '${r.title}':\n${r.description}` : r.description) : ''].filter(Boolean).join('\n\n');
        if (notes && notes !== k.description) updates.description = notes;
        if (r.checklist?.length) updates.checklist = [...(k.checklist ?? []), ...r.checklist.map((c) => ({ ...c }))];
        const tags = dedupe([...(k.tags ?? []), ...(r.tags ?? [])]); if (tags.length !== (k.tags ?? []).length) updates.tags = tags;
        const ctxs = dedupe([...(k.contexts ?? []), ...(r.contexts ?? [])]); if (ctxs.length !== (k.contexts ?? []).length) updates.contexts = ctxs;
        if (r.dueDate && (!k.dueDate || r.dueDate < k.dueDate)) updates.dueDate = r.dueDate;
        const undoOps: UndoOp[] = []; const changes: ChangeEntry['changes'] = [];
        if (Object.keys(updates).length) {
            const u = await applyUpdate(ctx, k, updates);
            if ('error' in u) return fail(u.error!);
            undoOps.push(u.undo!); changes.push(u.change!);
        }
        const del = await ctx.port.deleteTask(r.id);
        if (!del.success) return fail(del.error ?? 'Could not remove the duplicate');
        undoOps.push({ kind: 'restoreTask', taskId: r.id });
        changes.push({ taskId: r.id, title: r.title, before: { deleted: false }, after: { mergedInto: k.title } });
        return { ok: true, data: { kept: shortId(k.id), removed: shortId(r.id) }, change: { kind: 'merge', label: `Merged '${r.title}' into '${k.title}'`, undoOps: undoOps.reverse(), changes } };
    },
};

const archiveDone: AssistantTool = {
    name: 'archive_done_tasks',
    description: 'Archive completed tasks (optionally only those finished more than olderThanDays ago). More than 3 needs confirmation; undoable.',
    mutating: true,
    parameters: { type: 'object', properties: { olderThanDays: { type: 'integer', minimum: 0, maximum: 3650 } } },
    validate: (a, ctx) => (doneTasks(ctx, a.olderThanDays).length ? null : 'No completed tasks to archive.'),
    confirmation: (a, ctx) => {
        const t = doneTasks(ctx, a.olderThanDays);
        return t.length > BULK_CONFIRM_THRESHOLD ? { reason: `Archiving ${t.length} completed tasks`, summary: `Archive ${t.length} completed tasks`, affectedTaskIds: t.map((x) => x.id) } : null;
    },
    execute: async (a, ctx) => {
        const r = await mutateTaskLists(ctx, doneTasks(ctx, a.olderThanDays), () => ({ status: 'archived' as TaskStatus }));
        if (!r.changes.length) return fail('Nothing was archived.');
        return { ok: true, data: { archived: r.changes.length }, change: { kind: 'task', label: `Archived ${r.changes.length} completed task${r.changes.length === 1 ? '' : 's'}`, undoOps: r.undoOps, changes: r.changes } };
    },
};

function doneTasks(ctx: ToolContext, olderThanDays?: number): Task[] {
    const cutoff = olderThanDays ? ctx.now.getTime() - olderThanDays * 86_400_000 : Infinity;
    return ctx.port.getSnapshot().tasks.filter((t) => isLive(t) && t.status === 'done' && (!olderThanDays || (t.completedAt ? Date.parse(t.completedAt) < cutoff : false)));
}

// ---- scheduling ------------------------------------------------------------------------

function durationOf(t: Task, fallback = 30): number {
    const e = t.timeEstimate as string | undefined;
    if (!e) return fallback;
    const custom = /^custom:(\d+)/.exec(e); if (custom) return Number(custom[1]);
    const m = /^(\d+)(min|hr)/.exec(e); if (m) return Number(m[1]) * (m[2] === 'hr' ? 60 : 1);
    return fallback;
}
const minutesOf = (v: string) => Number(v.slice(11, 13)) * 60 + Number(v.slice(14, 16));
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

function timedOn(ctx: ToolContext, day: string, exceptId?: string): Array<{ task: Task; start: number; end: number }> {
    return ctx.port.getSnapshot().tasks.filter((t) => isActive(t) && t.id !== exceptId && hasTimeOf(t.startTime) && dayKeyOf(t.startTime) === day)
        .map((t) => ({ task: t, start: minutesOf(t.startTime!), end: minutesOf(t.startTime!) + durationOf(t) })).sort((a, b) => a.start - b.start);
}

function freeSlot(busy: Array<{ start: number; end: number }>, length: number, from: number, to: number): number | null {
    let cursor = from;
    for (const b of [...busy].sort((x, y) => x.start - y.start)) {
        if (b.end <= cursor) continue;
        if (b.start - cursor >= length) return cursor;
        cursor = Math.max(cursor, b.end);
    }
    return to - cursor >= length ? cursor : null;
}

const scheduleTask: AssistantTool = {
    name: 'schedule_task',
    description: 'Schedule a task at a start time ("YYYY-MM-DDTHH:mm"). Checks clashes with other timed tasks that day (calendar events are not visible to this tool). On a clash it refuses and suggests a free slot unless allowOverlap is true.',
    mutating: true,
    parameters: { type: 'object', required: ['id', 'startTime'], properties: { id: idProp, startTime: dateProp('Start (must include a time)'), durationMinutes: { type: 'integer', minimum: 5, maximum: 720, description: 'Default: task estimate or 30.' }, allowOverlap: { type: 'boolean' } } },
    validate: (a, ctx) => {
        const f = findTask(ctx, a.id); if ('error' in f) return f.error;
        const bad = validateWhen(ctx, a.startTime, 'startTime'); if (bad) return bad;
        if (!hasTimeOf(a.startTime)) return 'startTime needs a time of day ("YYYY-MM-DDTHH:mm").';
        if (a.allowOverlap) return null;
        const day = dayKeyOf(a.startTime)!; const start = minutesOf(a.startTime); const len = a.durationMinutes ?? durationOf(f.task);
        const clashes = timedOn(ctx, day, f.task.id).filter((b) => start < b.end && b.start < start + len);
        if (!clashes.length) return null;
        const slot = freeSlot(timedOn(ctx, day, f.task.id), len, start, 22 * 60);
        return `Clashes with ${clashes.map((c) => `'${c.task.title}' (${hhmm(c.start)}-${hhmm(c.end)})`).join(', ')}.${slot !== null ? ` Next free slot: ${day}T${hhmm(slot)}.` : ''} Offer the user that slot or pass allowOverlap.`;
    },
    execute: async (a, ctx) => {
        const task = (findTask(ctx, a.id) as { task: Task }).task;
        const updates: Partial<Task> = { startTime: normWhen(ctx, a.startTime) };
        if (a.durationMinutes && !task.timeEstimate) updates.timeEstimate = (a.durationMinutes % 60 === 0 && a.durationMinutes <= 240 ? `${a.durationMinutes / 60}hr` : `custom:${a.durationMinutes}`) as Task['timeEstimate'];
        const r = await applyUpdate(ctx, task, updates);
        if ('error' in r) return fail(r.error!);
        return { ok: true, data: { id: shortId(task.id), start: updates.startTime }, change: { kind: 'task', label: `Scheduled '${task.title}' · ${formatWhen(updates.startTime)}`, undoOps: [r.undo!], changes: [r.change!] } };
    },
};

const planDay: AssistantTool = {
    name: 'plan_day',
    description: 'PROPOSE time blocks for a day (does not change anything). Takes tasks due/starting that day, overdue and focused ones with no start time, and fits them into free slots. Show the plan, then apply with schedule_task steps in an apply_plan after user approval.',
    mutating: false,
    parameters: { type: 'object', properties: { date: dateProp('Day to plan (default today)'), workStart: { type: 'string', description: '"HH:mm", default 09:00.' }, workEnd: { type: 'string', description: '"HH:mm", default 18:00.' }, ids: { ...strArr(40), description: 'Plan exactly these tasks instead.' } } },
    validate: (a, ctx) => validateWhen(ctx, a.date, 'date', true),
    execute: async (a, ctx) => {
        const day = a.date ? String(a.date).slice(0, 10) : toLocalDay(ctx.now);
        const parse = (v: string | undefined, d: number) => { const m = /^(\d{1,2}):(\d{2})$/.exec(v ?? ''); return m ? Number(m[1]) * 60 + Number(m[2]) : d; };
        const from = Math.max(parse(a.workStart, 540), day === toLocalDay(ctx.now) ? Math.ceil((ctx.now.getHours() * 60 + ctx.now.getMinutes()) / 15) * 15 : 0);
        const to = parse(a.workEnd, 1080);
        const snapshot = ctx.port.getSnapshot();
        const pool = a.ids ? resolveIdsLenient(ctx, a.ids).tasks : snapshot.tasks.filter((t) => isActive(t) && t.status !== 'someday' && !hasTimeOf(t.startTime)
            && (dayKeyOf(t.dueDate) === day || dayKeyOf(t.startTime) === day || t.isFocusedToday === true || (day === toLocalDay(ctx.now) && (dayKeyOf(t.dueDate) ?? '9999') < day)));
        const weight: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
        pool.sort((x, y) => (x.isFocusedToday ? 0 : 1) - (y.isFocusedToday ? 0 : 1) || (weight[x.priority ?? ''] ?? 4) - (weight[y.priority ?? ''] ?? 4) || (x.dueDate ?? '9999').localeCompare(y.dueDate ?? '9999'));
        const busy: Array<{ start: number; end: number }> = timedOn(ctx, day);
        const blocks: Array<{ id: string; title: string; start: string; end: string }> = []; const unplaced: string[] = [];
        for (const t of pool) {
            const len = durationOf(t);
            const slot = freeSlot(busy, len, from, to);
            if (slot === null) { unplaced.push(t.title); continue; }
            busy.push({ start: slot, end: slot + len });
            blocks.push({ id: shortId(t.id), title: t.title, start: `${day}T${hhmm(slot)}`, end: hhmm(slot + len) });
        }
        blocks.sort((x, y) => x.start.localeCompare(y.start));
        return { ok: true, data: { date: day, existing: timedOn(ctx, day).map((b) => ({ title: b.task.title, start: hhmm(b.start), end: hhmm(b.end) })), proposed: blocks, unplaced } };
    },
};

const setRecurrence: AssistantTool = {
    name: 'set_recurrence',
    description: 'Make a task repeat (daily/weekly/monthly/yearly) or stop repeating (rule "none").',
    mutating: true,
    parameters: { type: 'object', required: ['id', 'rule'], properties: { id: idProp, rule: { type: 'string', enum: ['none', 'daily', 'weekly', 'monthly', 'yearly'] }, strategy: { type: 'string', enum: ['strict', 'fluid'], description: 'strict = fixed schedule, fluid = from completion.' }, byDay: { type: 'array', items: { type: 'string', enum: ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] }, maxItems: 7, description: 'Weekly only.' } } },
    validate: (a, ctx) => { const f = findTask(ctx, a.id); return 'error' in f ? f.error : a.byDay?.length && a.rule !== 'weekly' ? 'byDay only applies to weekly.' : null; },
    execute: async (a, ctx) => {
        const task = (findTask(ctx, a.id) as { task: Task }).task;
        const rec: Recurrence | undefined = a.rule === 'none' ? undefined : { rule: a.rule, ...(a.strategy ? { strategy: a.strategy } : {}), ...(a.byDay?.length ? { byDay: a.byDay } : {}) };
        const r = await applyUpdate(ctx, task, { recurrence: rec });
        if ('error' in r) return fail(r.error!);
        return { ok: true, data: { id: shortId(task.id), recurrence: a.rule }, change: { kind: 'task', label: a.rule === 'none' ? `Stopped repeating '${task.title}'` : `'${task.title}' now repeats ${a.rule}`, undoOps: [r.undo!], changes: [r.change!] } };
    },
};

const setFocus: AssistantTool = {
    name: 'set_focus',
    description: `Pick today's Focus tasks (max ${MAX_FOCUS}). focused=false removes them from Focus; replace=true first clears the current Focus list.`,
    mutating: true,
    parameters: { type: 'object', required: ['ids'], properties: { ids: idsProp, focused: { type: 'boolean', description: 'Default true.' }, replace: { type: 'boolean' } } },
    validate: (a, ctx) => {
        const { tasks } = resolveIdsLenient(ctx, a.ids);
        if (!tasks.length) return `None of the ids are known tasks (${a.ids.join(', ')}).`;
        if (a.focused === false) return null;
        const current = ctx.port.getSnapshot().tasks.filter((t) => isActive(t) && t.isFocusedToday === true && !tasks.some((x) => x.id === t.id));
        return (a.replace ? 0 : current.length) + tasks.length > MAX_FOCUS ? `Focus holds at most ${MAX_FOCUS} tasks (${current.length} already). Use replace=true or pick fewer.` : null;
    },
    execute: async (a, ctx) => {
        const { tasks, dropped } = resolveIdsLenient(ctx, a.ids);
        const focused = a.focused !== false;
        const targets = [...tasks];
        if (focused && a.replace) for (const t of ctx.port.getSnapshot().tasks) if (isActive(t) && t.isFocusedToday && !tasks.some((x) => x.id === t.id)) targets.push(t);
        const r = await mutateTaskLists(ctx, targets, (t) => ({ isFocusedToday: focused && tasks.some((x) => x.id === t.id) }));
        if (!r.changes.length) return fail('Focus was not changed.');
        return { ok: true, data: { changed: r.changes.length, dropped }, change: { kind: 'task', label: focused ? `Added ${tasks.length} task${tasks.length === 1 ? '' : 's'} to Focus` : `Removed ${tasks.length} task${tasks.length === 1 ? '' : 's'} from Focus`, undoOps: r.undoOps, changes: r.changes } };
    },
};

// ---- awareness -------------------------------------------------------------------------

const getOverview: AssistantTool = {
    name: 'get_overview',
    description: 'Workspace health check: counts per project and area, overdue tasks, inbox size, stale tasks (untouched 30+ days) and active projects with no open next action. Use before cleanup or triage.',
    mutating: false,
    parameters: { type: 'object', properties: {} },
    execute: async (_a, ctx) => {
        const { tasks, projects, areas } = ctx.port.getSnapshot();
        const open = tasks.filter(isActive);
        const today = toLocalDay(ctx.now);
        const staleCut = ctx.now.getTime() - STALE_DAYS * 86_400_000;
        const live = projects.filter((p) => !p.deletedAt && p.status !== 'archived');
        const activeProjects = live.filter((p) => p.status === 'active');
        const rows = (list: Task[]) => list.slice(0, 15).map((t) => compact(t, projects));
        const overdue = open.filter((t) => { const d = dayKeyOf(t.dueDate); return !!d && d < today; });
        const stale = open.filter((t) => t.status !== 'someday' && Date.parse(t.updatedAt) < staleCut);
        return {
            ok: true,
            data: {
                totals: { open: open.length, inbox: tasks.filter((t) => isLive(t) && t.status === 'inbox').length, overdue: overdue.length, stale: stale.length, done: tasks.filter((t) => isLive(t) && t.status === 'done').length },
                perProject: live.slice(0, 40).map((p) => ({ id: shortId(p.id), title: p.title, status: p.status, open: open.filter((t) => t.projectId === p.id).length })),
                perArea: areas.filter((a) => !a.deletedAt).map((a) => ({ id: shortId(a.id), name: a.name, projects: live.filter((p) => p.areaId === a.id).length })),
                overdue: rows(overdue.sort((x, y) => (x.dueDate ?? '').localeCompare(y.dueDate ?? ''))),
                stale: rows(stale.sort((x, y) => x.updatedAt.localeCompare(y.updatedAt))),
                projectsWithoutNextAction: activeProjects.filter((p) => !open.some((t) => t.projectId === p.id && t.status === 'next')).slice(0, 30).map((p) => ({ id: shortId(p.id), title: p.title, open: open.filter((t) => t.projectId === p.id).length })),
            },
        };
    },
};

export const EXTRA_TOOLS: AssistantTool[] = [
    updateProject, archiveProject, deleteProject, mergeProjects,
    deleteArea, assignProjectToArea,
    listTags, tagTasks, renameTag, deleteTag,
    bulkUpdate, findDuplicates, mergeTasks, archiveDone,
    scheduleTask, planDay, setRecurrence, setFocus,
    getOverview,
];
