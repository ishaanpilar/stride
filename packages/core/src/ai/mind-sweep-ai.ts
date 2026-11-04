import { parseQuickAdd } from '../quick-add';
import type { Area, Project, Task, TaskPriority, TaskStatus, TimeEstimate } from '../types';
import { parseWhen, toLocalDateTime } from './assistant/dates';
import type { AssistantStorePort } from './assistant/types';
import type { AIProvider } from './types';
import { normalizeTimeEstimate } from './utils';

/**
 * Quick AI Mind Sweep: the user dumps everything on their mind into one text box; the model
 * proposes projects + tasks; the user reviews and confirms. Pure helpers only: prompt building,
 * strict validation of untrusted model output, a non-AI fallback, and applying through a store port.
 */

export const MIND_SWEEP_AI_DEFAULT_TIMEOUT_MS = 45_000;
export const MIND_SWEEP_MAX_ITEMS = 60;
export const MIND_SWEEP_MAX_PROJECTS = 12;
export const MIND_SWEEP_MAX_INPUT_CHARS = 12_000;
const MAX_NAMES = 60;
const TITLE_MAX = 200;

export type MindSweepKind = 'next' | 'waiting' | 'someday' | 'reference' | 'calendar' | 'inbox';
const AI_KINDS: readonly MindSweepKind[] = ['next', 'waiting', 'someday', 'reference', 'calendar'];
const PRIORITIES: readonly TaskPriority[] = ['low', 'medium', 'high', 'urgent'];

export interface MindSweepProposalProject {
    ref: string;
    title: string;
    areaName?: string;
    dueDate?: string;
}

export interface MindSweepProposalItem {
    /** Stable local key for the review UI. */
    key: string;
    title: string;
    kind: MindSweepKind;
    projectRef?: string;
    projectName?: string;
    dueDate?: string;
    startTime?: string;
    contexts?: string[];
    tags?: string[];
    priority?: TaskPriority;
    timeEstimate?: TimeEstimate;
    notes?: string;
    waitingFor?: string;
}

export interface MindSweepProposal {
    projects: MindSweepProposalProject[];
    items: MindSweepProposalItem[];
    summary: string;
    source: 'ai' | 'fallback';
    /** Set on the fallback path: 'disabled' (AI off/unconfigured) or 'failed'. */
    fallbackReason?: 'disabled' | 'failed';
}

export interface MindSweepContext {
    now: Date;
    timeZone?: string;
    projects: readonly string[];
    areas: readonly string[];
    contexts: readonly string[];
}

export interface MindSweepPromptInput extends MindSweepContext {
    text: string;
}

const clip = (value: string, max: number): string => (value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown, max: number): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed ? clip(trimmed, max) : undefined;
};
const names = (list: readonly string[]): string[] => Array.from(new Set(list.map((n) => n.trim()).filter(Boolean))).slice(0, MAX_NAMES);

export function buildMindSweepPrompt(input: MindSweepPromptInput): { system: string; user: string } {
    const { now, timeZone } = input;
    const weekday = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()];
    const system = [
        'You are a GTD assistant. The user dumps everything on their mind as free text; turn it into a clean, reviewable set of projects and tasks.',
        'Respond with a single JSON object only, no prose, no markdown, matching exactly this shape:',
        '{"projects": [{"ref": string (short unique id like "p1"), "title": string, "areaName": string (optional, must match a known area exactly), "dueDate": string (optional)}],',
        ' "items": [{"title": string, "kind": "next"|"waiting"|"someday"|"reference"|"calendar",',
        '   "projectRef": string (optional, ref of a NEW project above) | "projectName": string (optional, EXACT name of an existing project),',
        '   "dueDate": string (optional), "startTime": string (optional), "contexts": string[] (optional, prefer known contexts), "tags": string[] (optional),',
        '   "priority": "low"|"medium"|"high"|"urgent" (optional), "timeEstimate": "5min"|"10min"|"15min"|"30min"|"1hr"|"2hr"|"3hr"|"4hr"|"4hr+" (optional),',
        '   "notes": string (optional), "waitingFor": string (optional, person)}],',
        ' "summary": string (one short sentence describing what you organised)}.',
        'Rules:',
        `- Split the text into atomic, actionable items (at most ${MIND_SWEEP_MAX_ITEMS}). Titles are short and verb-first ("Call the dentist").`,
        '- A multi-step outcome becomes a NEW project with its next actions; single actions stay standalone. Use an existing project only if its name clearly fits.',
        '- kind "waiting" = someone else owes the user something (set waitingFor); "someday" = vague ideas/maybe-later; "reference" = information to keep, not an action; "calendar" = tied to a specific date/time; otherwise "next".',
        `- Dates: today is ${weekday} ${toLocalDateTime(now)}${timeZone ? ` (${timeZone})` : ''}. Resolve relative dates against it. Use local "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm". If a date is unclear or in the past, omit it; never guess.`,
        '- Do NOT invent tasks, people, or details the user did not mention.',
        '- Keep the user\'s language for titles.',
    ].join('\n');

    const list = (label: string, values: readonly string[]) => {
        const n = names(values);
        return n.length ? `${label}: ${JSON.stringify(n)}` : '';
    };
    const user = [
        list('EXISTING_PROJECTS', input.projects),
        list('KNOWN_AREAS', input.areas),
        list('KNOWN_CONTEXTS', input.contexts),
        'BRAIN_DUMP:',
        input.text.trim().slice(0, MIND_SWEEP_MAX_INPUT_CHARS),
    ].filter(Boolean).join('\n');
    return { system, user };
}

const extractJson = (raw: string): unknown => {
    const trimmed = String(raw ?? '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    if (!trimmed) return undefined;
    const candidates = [trimmed];
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start !== -1 && end > start) candidates.push(trimmed.slice(start, end + 1));
    for (const candidate of candidates) {
        try {
            return JSON.parse(candidate);
        } catch {
            // try next
        }
    }
    return undefined;
};

const validWhen = (value: unknown, now: Date): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const parsed = parseWhen(value, now);
    return parsed.ok ? parsed.value : undefined;
};

const normList = (value: unknown, prefix: '@' | '#', limit = 10): string[] | undefined => {
    if (!Array.isArray(value)) return undefined;
    const out = new Set<string>();
    for (const entry of value) {
        const s = str(entry, 40);
        if (!s) continue;
        out.add(s.startsWith(prefix) ? s : `${prefix}${s}`);
        if (out.size >= limit) break;
    }
    return out.size ? Array.from(out) : undefined;
};

/** Validate untrusted model output. Returns null when nothing usable remains. */
export function parseMindSweepProposal(raw: unknown, ctx: MindSweepContext): MindSweepProposal | null {
    const value = typeof raw === 'string' ? extractJson(raw) : raw;
    if (!isRecord(value)) return null;

    const areaByLower = new Map(ctx.areas.map((a) => [a.trim().toLowerCase(), a.trim()]));
    const projectByLower = new Map(ctx.projects.map((p) => [p.trim().toLowerCase(), p.trim()]));

    const projects: MindSweepProposalProject[] = [];
    const refs = new Set<string>();
    if (Array.isArray(value.projects)) {
        for (const entry of value.projects) {
            if (!isRecord(entry) || projects.length >= MIND_SWEEP_MAX_PROJECTS) continue;
            const ref = str(entry.ref, 40);
            const title = str(entry.title, TITLE_MAX);
            if (!ref || !title || refs.has(ref)) continue;
            // A "new" project that duplicates an existing one is not new: items will use projectName instead.
            if (projectByLower.has(title.toLowerCase())) continue;
            refs.add(ref);
            const areaName = typeof entry.areaName === 'string' ? areaByLower.get(entry.areaName.trim().toLowerCase()) : undefined;
            const dueDate = validWhen(entry.dueDate, ctx.now);
            projects.push({ ref, title, ...(areaName ? { areaName } : {}), ...(dueDate ? { dueDate } : {}) });
        }
    }
    const projectRefByTitle = new Map(projects.map((p) => [p.title.toLowerCase(), p.ref]));

    const items: MindSweepProposalItem[] = [];
    const seen = new Set<string>();
    if (Array.isArray(value.items)) {
        for (const entry of value.items) {
            if (!isRecord(entry) || items.length >= MIND_SWEEP_MAX_ITEMS) continue;
            const title = str(entry.title, TITLE_MAX);
            if (!title) continue;
            const dedupeKey = title.toLowerCase();
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);

            const kind: MindSweepKind = AI_KINDS.includes(entry.kind as MindSweepKind) ? (entry.kind as MindSweepKind) : 'next';
            const item: MindSweepProposalItem = { key: `i${items.length + 1}`, title, kind };

            const projectRef = str(entry.projectRef, 40);
            if (projectRef && refs.has(projectRef)) item.projectRef = projectRef;
            else if (typeof entry.projectName === 'string') {
                const trimmed = entry.projectName.trim();
                const existing = projectByLower.get(trimmed.toLowerCase());
                if (existing) item.projectName = existing;
                else {
                    const newRef = projectRefByTitle.get(trimmed.toLowerCase());
                    if (newRef) item.projectRef = newRef;
                }
            }

            const dueDate = validWhen(entry.dueDate, ctx.now);
            const startTime = validWhen(entry.startTime, ctx.now);
            if (dueDate) item.dueDate = dueDate;
            if (startTime) item.startTime = startTime;
            const contexts = normList(entry.contexts, '@');
            const tags = normList(entry.tags, '#');
            if (contexts) item.contexts = contexts;
            if (tags) item.tags = tags;
            if (PRIORITIES.includes(entry.priority as TaskPriority)) item.priority = entry.priority as TaskPriority;
            const estimate = typeof entry.timeEstimate === 'string' ? normalizeTimeEstimate(entry.timeEstimate) : undefined;
            if (estimate) item.timeEstimate = estimate as TimeEstimate;
            const notes = str(entry.notes, 1000);
            if (notes) item.notes = notes;
            const waitingFor = str(entry.waitingFor, 80);
            if (waitingFor) item.waitingFor = waitingFor;
            items.push(item);
        }
    }

    if (items.length === 0 && projects.length === 0) return null;
    const summary = str(value.summary, 240) ?? '';
    return { projects, items, summary, source: 'ai' };
}

export type GenerateMindSweepOptions = { timeoutMs?: number };

/** Returns a validated proposal, or null on ANY problem (empty input, unsupported provider, network, timeout, bad output). Never throws. */
export async function generateMindSweepProposal(
    provider: Pick<AIProvider, 'generateText'>,
    input: MindSweepPromptInput,
    options: GenerateMindSweepOptions = {},
): Promise<MindSweepProposal | null> {
    const generate = provider.generateText;
    if (typeof generate !== 'function' || !input.text.trim()) return null;
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : MIND_SWEEP_AI_DEFAULT_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const prompt = buildMindSweepPrompt(input);
        const timeout = new Promise<null>((resolve) => {
            timer = setTimeout(() => {
                controller.abort();
                resolve(null);
            }, timeoutMs);
        });
        const text = await Promise.race([
            generate.call(provider, prompt, { signal: controller.signal }),
            timeout,
        ]);
        if (text === null) return null;
        return parseMindSweepProposal(text, input);
    } catch {
        return null;
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/** Non-AI fallback: every line / bullet becomes an Inbox item, parsed with quick-add syntax. */
export function buildFallbackMindSweepProposal(
    text: string,
    reason: 'disabled' | 'failed',
    now: Date = new Date(),
    projects: Project[] = [],
    areas: Area[] = [],
): MindSweepProposal {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n')
        .map((line) => line.trim())
        .map((line) => line.replace(/^\s*(?:[-*•–]|\d+[.)])\s+/, '').trim())
        .filter(Boolean)
        .slice(0, MIND_SWEEP_MAX_ITEMS);
    const items: MindSweepProposalItem[] = [];
    const seen = new Set<string>();
    for (const line of lines) {
        const parsed = parseQuickAdd(line, projects, now, areas);
        const title = clip((parsed.title || line).trim(), TITLE_MAX);
        if (!title || seen.has(title.toLowerCase())) continue;
        seen.add(title.toLowerCase());
        const item: MindSweepProposalItem = { key: `i${items.length + 1}`, title, kind: 'inbox' };
        const props = parsed.props;
        if (props.dueDate) item.dueDate = props.dueDate;
        if (props.startTime) item.startTime = props.startTime;
        if (props.contexts?.length) item.contexts = props.contexts;
        if (props.tags?.length) item.tags = props.tags;
        if (props.priority) item.priority = props.priority;
        const project = parsed.projectTitle ? projects.find((p) => p.title.toLowerCase() === parsed.projectTitle!.toLowerCase()) : undefined;
        if (project) item.projectName = project.title;
        items.push(item);
    }
    return { projects: [], items, summary: '', source: 'fallback', fallbackReason: reason };
}

const KIND_STATUS: Record<MindSweepKind, TaskStatus> = {
    next: 'next', waiting: 'waiting', someday: 'someday', reference: 'reference', calendar: 'next', inbox: 'inbox',
};
const PROJECT_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

export interface ApplyMindSweepResult {
    projectIds: string[];
    taskIds: string[];
    failed: string[];
}

/**
 * Create the approved projects first, then items, through the shared store port.
 * `included` filters which items/projects the user kept. A project with no kept items is skipped.
 */
export async function applyMindSweepProposal(
    proposal: Pick<MindSweepProposal, 'projects' | 'items'>,
    port: Pick<AssistantStorePort, 'getSnapshot' | 'addTask' | 'addProject'>,
): Promise<ApplyMindSweepResult> {
    const snapshot = port.getSnapshot();
    const existingProjects = snapshot.projects.filter((p) => !p.deletedAt);
    const result: ApplyMindSweepResult = { projectIds: [], taskIds: [], failed: [] };
    const refToId = new Map<string, string>();
    const usedRefs = new Set(proposal.items.map((i) => i.projectRef).filter(Boolean) as string[]);

    let colorIndex = existingProjects.length;
    for (const project of proposal.projects) {
        if (!usedRefs.has(project.ref)) continue;
        const props: Partial<Project> = { status: 'active' };
        if (project.dueDate) props.dueDate = project.dueDate;
        const area = project.areaName ? snapshot.areas.find((a) => !a.deletedAt && a.name.toLowerCase() === project.areaName!.toLowerCase()) : undefined;
        if (area) props.areaId = area.id;
        try {
            const created = await port.addProject(project.title, PROJECT_COLORS[colorIndex++ % PROJECT_COLORS.length], props);
            if (created) {
                refToId.set(project.ref, created.id);
                result.projectIds.push(created.id);
            } else result.failed.push(project.title);
        } catch {
            result.failed.push(project.title);
        }
    }

    for (const item of proposal.items) {
        const props: Partial<Task> = { status: KIND_STATUS[item.kind] };
        const projectId = item.projectRef
            ? refToId.get(item.projectRef)
            : item.projectName
                ? existingProjects.find((p) => p.title === item.projectName)?.id
                : undefined;
        if (projectId) props.projectId = projectId;
        if (item.dueDate) props.dueDate = item.dueDate;
        if (item.startTime) props.startTime = item.startTime;
        if (item.contexts?.length) props.contexts = item.contexts;
        if (item.tags?.length) props.tags = item.tags;
        if (item.priority) props.priority = item.priority;
        if (item.timeEstimate) props.timeEstimate = item.timeEstimate;
        if (item.notes) props.description = item.notes;
        if (item.waitingFor && item.kind === 'waiting') props.assignedTo = item.waitingFor;
        try {
            const res = await port.addTask(item.title, props);
            if (res.success && res.id) result.taskIds.push(res.id);
            else result.failed.push(item.title);
        } catch {
            result.failed.push(item.title);
        }
    }
    return result;
}

/** Undo a whole sweep: tasks first, then the projects it created. */
export async function undoMindSweep(
    applied: Pick<ApplyMindSweepResult, 'projectIds' | 'taskIds'>,
    port: Pick<AssistantStorePort, 'deleteTask' | 'deleteProject'>,
): Promise<boolean> {
    let ok = true;
    for (const id of [...applied.taskIds].reverse()) {
        try { ok = (await port.deleteTask(id)).success && ok; } catch { ok = false; }
    }
    for (const id of [...applied.projectIds].reverse()) {
        try { ok = (await port.deleteProject(id)).success && ok; } catch { ok = false; }
    }
    return ok;
}
