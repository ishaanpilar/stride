import { endOfDay, startOfDay } from 'date-fns';

import { safeParseDate, safeParseDueDate } from '../date';
import { isTaskInActiveProject } from '../project-utils';
import { isTaskActionable } from '../task-status';
import { isTaskFocusedNow } from '../task-utils';
import type { AppData, Project, Task } from '../types';
import type { AIProvider } from './types';

/**
 * AI-powered morning briefing.
 *
 * Pure helpers: build a compact (ids/titles/due/priority/project/context/status only) snapshot,
 * build the prompt, validate the model's JSON, and generate with a hard timeout. Any failure
 * resolves to `null` so callers can fall back to the non-AI digest.
 */

export const DAILY_BRIEFING_DEFAULT_TIMEOUT_MS = 20_000;
export const DAILY_BRIEFING_MAX_TOP = 5;
export const DAILY_BRIEFING_MAX_SCHEDULE = 8;
export const DAILY_BRIEFING_HEADLINE_MAX = 80;
const UPCOMING_DAYS = 3;
const BUCKET_LIMITS = { overdue: 10, dueToday: 15, scheduled: 10, focus: 10, upcoming: 10, waiting: 8, nextActions: 15 } as const;

export interface BriefingTask {
    id: string;
    title: string;
    status: Task['status'];
    due?: string;
    start?: string;
    priority?: Task['priority'];
    project?: string;
    context?: string;
}

export interface DailyBriefingInput {
    date: string;
    overdue: BriefingTask[];
    dueToday: BriefingTask[];
    scheduled: BriefingTask[];
    focus: BriefingTask[];
    upcoming: BriefingTask[];
    waiting: BriefingTask[];
    nextActions: BriefingTask[];
}

export interface DailyBriefing {
    headline: string;
    top: Array<{ taskId: string; why: string; estimateMinutes?: number }>;
    schedule: Array<{ time: string; title: string }>;
    suggestion: string;
}

export const DAILY_BRIEFING_JSON_SCHEMA = {
    type: 'object',
    required: ['headline', 'top', 'schedule', 'suggestion'],
    properties: {
        headline: { type: 'string', maxLength: DAILY_BRIEFING_HEADLINE_MAX },
        top: {
            type: 'array',
            maxItems: DAILY_BRIEFING_MAX_TOP,
            items: {
                type: 'object',
                required: ['taskId', 'why'],
                properties: {
                    taskId: { type: 'string' },
                    why: { type: 'string' },
                    estimateMinutes: { type: 'number' },
                },
            },
        },
        schedule: {
            type: 'array',
            items: { type: 'object', required: ['time', 'title'], properties: { time: { type: 'string' }, title: { type: 'string' } } },
        },
        suggestion: { type: 'string' },
    },
} as const;

export function localDayKey(now: Date): string {
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${m}-${d}`;
}

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

const clip = (value: string, max: number): string => (value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value);

export function buildDailyBriefingInput(tasks: Task[], projects: Project[] = [], now: Date = new Date()): DailyBriefingInput {
    const dayStart = startOfDay(now).getTime();
    const dayEnd = endOfDay(now).getTime();
    const upcomingEnd = dayEnd + UPCOMING_DAYS * 24 * 60 * 60 * 1000;
    const projectMap = new Map(projects.map((project) => [project.id, project]));

    const buckets: Record<keyof typeof BUCKET_LIMITS, Task[]> = {
        overdue: [], dueToday: [], scheduled: [], focus: [], upcoming: [], waiting: [], nextActions: [],
    };

    for (const task of tasks) {
        if (task.deletedAt || !isTaskActionable(task)) continue;
        if (task.status === 'someday' || (task.status === 'inbox' && !task.dueDate && !task.startTime)) continue;
        if (!isTaskInActiveProject(task, projectMap)) continue;

        const due = safeParseDueDate(task.dueDate)?.getTime();
        const start = safeParseDate(task.startTime)?.getTime();
        if (due !== undefined && due < dayStart) buckets.overdue.push(task);
        else if (due !== undefined && due <= dayEnd) buckets.dueToday.push(task);
        else if (start !== undefined && start >= dayStart && start <= dayEnd) buckets.scheduled.push(task);
        else if (isTaskFocusedNow(task, now)) buckets.focus.push(task);
        else if (due !== undefined && due <= upcomingEnd) buckets.upcoming.push(task);
        else if (task.status === 'waiting') buckets.waiting.push(task);
        else if (task.status === 'next' && (start === undefined || start <= dayEnd)) buckets.nextActions.push(task);
    }

    const sortTasks = (list: Task[]) => [...list].sort((a, b) => {
        const byPriority = (PRIORITY_RANK[a.priority ?? ''] ?? 4) - (PRIORITY_RANK[b.priority ?? ''] ?? 4);
        if (byPriority !== 0) return byPriority;
        return String(a.dueDate ?? a.startTime ?? '').localeCompare(String(b.dueDate ?? b.startTime ?? ''));
    });

    const compact = (task: Task): BriefingTask => {
        const project = task.projectId ? projectMap.get(task.projectId)?.title : undefined;
        const context = task.contexts?.[0];
        return {
            id: task.id,
            title: clip(String(task.title ?? ''), 100),
            status: task.status,
            ...(task.dueDate ? { due: task.dueDate.slice(0, 16) } : {}),
            ...(task.startTime ? { start: task.startTime.slice(0, 16) } : {}),
            ...(task.priority ? { priority: task.priority } : {}),
            ...(project ? { project: clip(project, 40) } : {}),
            ...(context ? { context } : {}),
        };
    };

    const out = { date: localDayKey(now) } as DailyBriefingInput;
    for (const key of Object.keys(BUCKET_LIMITS) as Array<keyof typeof BUCKET_LIMITS>) {
        out[key] = sortTasks(buckets[key]).slice(0, BUCKET_LIMITS[key]).map(compact);
    }
    return out;
}

export function hasBriefingContent(input: DailyBriefingInput): boolean {
    return (['overdue', 'dueToday', 'scheduled', 'focus', 'upcoming', 'waiting', 'nextActions'] as const)
        .some((key) => input[key].length > 0);
}

export function buildDailyBriefingPrompt(input: DailyBriefingInput, language?: string): { system: string; user: string } {
    const system = [
        'You are a GTD assistant writing a short, prioritised plan for the user\'s day.',
        'Respond with a single JSON object only, no prose, no markdown, matching exactly this shape:',
        '{"headline": string (<= 80 chars, e.g. "3 urgent, 2 meetings, 1 overdue"),',
        ' "top": [{"taskId": string, "why": string (<= 100 chars), "estimateMinutes": number (optional)}] (max 5, ordered by what to do first),',
        ' "schedule": [{"time": string (e.g. "09:30"), "title": string}] (only items that have a start time today),',
        ' "suggestion": string (one concrete focus suggestion, e.g. which task to start a Pomodoro on first)}.',
        'Only use taskId values that appear in the input. Never invent tasks.',
        language ? `Write all text fields in the language with code "${language}".` : '',
    ].filter(Boolean).join('\n');

    const section = (label: string, list: BriefingTask[]) =>
        list.length ? `${label}:\n${list.map((task) => JSON.stringify(task)).join('\n')}` : '';
    const user = [
        `Today is ${input.date}. Plan my day. Return JSON.`,
        section('OVERDUE', input.overdue),
        section('DUE_TODAY', input.dueToday),
        section('SCHEDULED_TODAY', input.scheduled),
        section('FOCUS_STARRED', input.focus),
        section('DUE_NEXT_3_DAYS', input.upcoming),
        section('WAITING_FOLLOW_UP', input.waiting),
        section('NEXT_ACTIONS', input.nextActions),
    ].filter(Boolean).join('\n\n');
    return { system, user };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

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
            // try next candidate
        }
    }
    return undefined;
};

/** Validate model output. Drops unknown task ids / malformed entries; returns null if unusable. */
export function parseDailyBriefing(raw: string | unknown, knownTaskIds: ReadonlySet<string> | readonly string[]): DailyBriefing | null {
    const known = knownTaskIds instanceof Set ? knownTaskIds : new Set(knownTaskIds as readonly string[]);
    const value = typeof raw === 'string' ? extractJson(raw) : raw;
    if (!isRecord(value)) return null;

    const top: DailyBriefing['top'] = [];
    const seen = new Set<string>();
    if (Array.isArray(value.top)) {
        for (const item of value.top) {
            if (!isRecord(item) || typeof item.taskId !== 'string') continue;
            const taskId = item.taskId.trim();
            if (!known.has(taskId) || seen.has(taskId)) continue;
            seen.add(taskId);
            const why = typeof item.why === 'string' ? clip(item.why.trim(), 140) : '';
            const minutes = typeof item.estimateMinutes === 'number' && Number.isFinite(item.estimateMinutes)
                ? Math.round(item.estimateMinutes)
                : undefined;
            top.push({
                taskId,
                why,
                ...(minutes !== undefined && minutes > 0 && minutes <= 600 ? { estimateMinutes: minutes } : {}),
            });
            if (top.length >= DAILY_BRIEFING_MAX_TOP) break;
        }
    }

    const schedule: DailyBriefing['schedule'] = [];
    if (Array.isArray(value.schedule)) {
        for (const item of value.schedule) {
            if (!isRecord(item) || typeof item.time !== 'string' || typeof item.title !== 'string') continue;
            const time = item.time.trim();
            const title = item.title.trim();
            if (!time || !title) continue;
            schedule.push({ time: clip(time, 16), title: clip(title, 100) });
            if (schedule.length >= DAILY_BRIEFING_MAX_SCHEDULE) break;
        }
    }

    const headline = typeof value.headline === 'string' ? clip(value.headline.trim(), DAILY_BRIEFING_HEADLINE_MAX) : '';
    const suggestion = typeof value.suggestion === 'string' ? clip(value.suggestion.trim(), 240) : '';
    // A briefing with nothing usable in it is treated as a failure so the caller falls back.
    if (!headline && top.length === 0 && !suggestion) return null;
    return { headline: headline || `${top.length} priorities today`, top, schedule, suggestion };
}

export function collectBriefingTaskIds(input: DailyBriefingInput): Set<string> {
    const ids = new Set<string>();
    for (const key of ['overdue', 'dueToday', 'scheduled', 'focus', 'upcoming', 'waiting', 'nextActions'] as const) {
        for (const task of input[key]) ids.add(task.id);
    }
    return ids;
}

export type GenerateDailyBriefingOptions = {
    provider: Pick<AIProvider, 'generateText'>;
    tasks: Task[];
    projects?: Project[];
    now?: Date;
    language?: string;
    timeoutMs?: number;
};

/**
 * Returns a validated briefing, or null on ANY problem (no content, unsupported provider,
 * network error, timeout, malformed output). Never throws.
 */
export async function generateDailyBriefing(options: GenerateDailyBriefingOptions): Promise<DailyBriefing | null> {
    const generate = options.provider.generateText;
    if (typeof generate !== 'function') return null;
    const input = buildDailyBriefingInput(options.tasks, options.projects ?? [], options.now ?? new Date());
    if (!hasBriefingContent(input)) return null;
    const prompt = buildDailyBriefingPrompt(input, options.language);
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : DAILY_BRIEFING_DEFAULT_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const timeout = new Promise<null>((resolve) => {
            timer = setTimeout(() => {
                controller.abort();
                resolve(null);
            }, timeoutMs);
        });
        const text = await Promise.race([
            generate.call(options.provider, prompt, { signal: controller.signal }),
            timeout,
        ]);
        if (text === null) return null;
        return parseDailyBriefing(text, collectBriefingTaskIds(input));
    } catch {
        return null;
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/** Default on when AI is enabled; explicit `false` opts out. */
export function isAIMorningBriefingEnabled(settings: AppData['settings'] | undefined): boolean {
    const ai = settings?.ai;
    return ai?.enabled === true && ai.morningBriefing !== false;
}

export interface CachedDailyBriefing {
    date: string;
    generatedAt: string;
    briefing: DailyBriefing;
}

// LEGACY: pre-Stride-rename value, kept so existing stored user data stays readable.
export const DAILY_BRIEFING_CACHE_KEY = 'mindwtr:daily-briefing:v1';

export function serializeBriefingCache(date: string, briefing: DailyBriefing, now: Date = new Date()): string {
    const entry: CachedDailyBriefing = { date, generatedAt: now.toISOString(), briefing };
    return JSON.stringify(entry);
}

/** Returns the cached briefing only if it was generated for `date` (and still validates). */
export function parseBriefingCache(raw: string | null | undefined, date: string): CachedDailyBriefing | null {
    if (!raw) return null;
    try {
        const entry = JSON.parse(raw) as unknown;
        if (!isRecord(entry) || entry.date !== date || typeof entry.generatedAt !== 'string') return null;
        // Task ids may have changed since; only structural validation here (UI skips missing tasks).
        const ids = isRecord(entry.briefing) && Array.isArray(entry.briefing.top)
            ? (entry.briefing.top as unknown[]).map((item) => (isRecord(item) ? String(item.taskId) : ''))
            : [];
        const briefing = parseDailyBriefing(entry.briefing, new Set(ids));
        return briefing ? { date, generatedAt: entry.generatedAt, briefing } : null;
    } catch {
        return null;
    }
}
