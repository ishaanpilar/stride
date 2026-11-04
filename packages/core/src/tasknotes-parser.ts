import type { TaskPriority } from './types';
import { splitObsidianFrontmatter } from './obsidian-frontmatter';
import {
    buildObsidianFileTaskId,
    extractObsidianWikiLinks,
    normalizeObsidianRelativePath,
    normalizeObsidianTagValue,
    uniqueObsidianStrings,
    type ObsidianTask,
    type ObsidianTaskNotesStatus,
    type ParseObsidianTasksOptions,
} from './obsidian-parser';

export const DEFAULT_TASKNOTES_FOLDER = 'TaskNotes';

export type ParseTaskNotesFileOptions = ParseObsidianTasksOptions & {
    includeArchived?: boolean;
};

export type ParseTaskNotesFileResult = {
    task: ObsidianTask | null;
    matchesTaskNotesFormat: boolean;
    skipInlineParsing: boolean;
};

const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string');

const readStringArray = (value: unknown): string[] => {
    if (typeof value === 'string') return [value];
    if (isStringArray(value)) return value;
    return [];
};

const normalizeTaskNotesPriority = (value: unknown): TaskPriority | null => {
    if (typeof value !== 'string') return null;
    switch (value.trim().toLowerCase()) {
        case 'high':
        case 'highest':
            return 'high';
        case 'normal':
        case 'medium':
            return 'medium';
        case 'low':
        case 'lowest':
            return 'low';
        case 'urgent':
            return 'urgent';
        default:
            return null;
    }
};

const mapTaskNotesStatus = (value: string | boolean): {
    completed: boolean;
    strideStatus: ObsidianTaskNotesStatus;
    rawStatus: string;
} => {
    if (typeof value === 'boolean') {
        return {
            completed: value,
            strideStatus: value ? 'done' : 'inbox',
            rawStatus: value ? 'true' : 'false',
        };
    }

    const normalized = value.trim().toLowerCase();
    switch (normalized) {
        case 'done':
        case 'completed':
            return { completed: true, strideStatus: 'done', rawStatus: normalized };
        case 'cancelled':
        case 'canceled':
            return { completed: true, strideStatus: 'archived', rawStatus: normalized };
        case 'waiting':
            return { completed: false, strideStatus: 'waiting', rawStatus: normalized };
        case 'someday':
        case 'someday/maybe':
            return { completed: false, strideStatus: 'someday', rawStatus: normalized };
        case 'in-progress':
        case 'active':
            return { completed: false, strideStatus: 'next', rawStatus: normalized };
        case 'none':
        case 'open':
        case 'todo':
        default:
            return { completed: false, strideStatus: 'inbox', rawStatus: normalized || 'open' };
    }
};

const isIsoDateValue = (value: unknown): value is string => {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:[T ][\s\S]+)?$/.test(value.trim());
};

const parseTaskNotesDate = (value: unknown): string | null => {
    if (!isIsoDateValue(value)) return null;
    return value.trim();
};

const mapTaskNotesTags = (tags: string[]): string[] => {
    return uniqueObsidianStrings(
        tags
            .map(normalizeObsidianTagValue)
            .filter((tag) => tag && tag.toLowerCase() !== 'task')
    );
};

const mapTaskNotesContexts = (contexts: string[]): string[] => {
    return uniqueObsidianStrings(
        contexts
            .map((context) => context.trim())
            .filter(Boolean)
            .map((context) => context.startsWith('@') ? context.slice(1) : context)
    );
};

const mapTaskNotesProjects = (projects: string[]): string[] => {
    return uniqueObsidianStrings(projects.map((project) => {
        const trimmed = project.trim();
        const match = trimmed.match(/^\[\[([^\]|]+)(?:\|[^\]]+)?\]\]$/);
        return match?.[1]?.trim() || trimmed;
    }).filter(Boolean));
};

const extractBodyPreview = (body: string, maxLen = 200): string | null => {
    const normalized = body
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
        .join(' ')
        .trim();
    if (!normalized) return null;
    return normalized.length > maxLen ? `${normalized.slice(0, maxLen - 3).trimEnd()}...` : normalized;
};

const resolveTaskNotesTitle = (frontmatterTitle: unknown, body: string, filename: string): string => {
    if (typeof frontmatterTitle === 'string' && frontmatterTitle.trim()) {
        return frontmatterTitle.trim();
    }
    const headingMatch = body.match(/^#\s+(.+)$/m);
    if (headingMatch?.[1]?.trim()) {
        return headingMatch[1].trim();
    }
    return filename.replace(/\.md$/i, '').trim();
};

const isViewsFile = (relativeFilePath: string): boolean => {
    return /(?:^|\/)Views\//.test(relativeFilePath);
};

const isArchiveFile = (relativeFilePath: string): boolean => {
    return /(?:^|\/)Archive\//.test(relativeFilePath);
};

const hasTaskNotesSignal = (relativeFilePath: string, properties: Record<string, unknown>): boolean => {
    const tags = readStringArray(properties.tags).map(normalizeObsidianTagValue);
    const hasStatus = typeof properties.status === 'string'
        ? properties.status.trim().length > 0
        : typeof properties.status === 'boolean';
    if (!hasStatus) return false;

    const hasTaskNotesPathHint = /(?:^|\/)TaskNotes(?:\/|$)/.test(relativeFilePath);
    const hasTaskTag = tags.some((tag) => tag.toLowerCase() === 'task');
    const hasTaskMetadata = ['title', 'priority', 'due', 'scheduled', 'contexts', 'projects', 'timeEstimate', 'recurrence', 'completedDate']
        .some((key) => properties[key] !== undefined);

    return hasTaskNotesPathHint || hasTaskTag || hasTaskMetadata;
};

export const parseTaskNotesFile = (
    content: string,
    options: ParseTaskNotesFileOptions
): ParseTaskNotesFileResult => {
    const normalizedRelativePath = normalizeObsidianRelativePath(options.relativeFilePath);
    const split = splitObsidianFrontmatter(content);

    if (isViewsFile(normalizedRelativePath)) {
        return { task: null, matchesTaskNotesFormat: false, skipInlineParsing: true };
    }

    if (!hasTaskNotesSignal(normalizedRelativePath, split.properties)) {
        return { task: null, matchesTaskNotesFormat: false, skipInlineParsing: false };
    }

    if (isArchiveFile(normalizedRelativePath) && options.includeArchived !== true) {
        return { task: null, matchesTaskNotesFormat: true, skipInlineParsing: true };
    }

    const filename = normalizedRelativePath.split('/').pop() || normalizedRelativePath;
    const title = resolveTaskNotesTitle(split.properties.title, split.body, filename);
    if (!title) {
        return { task: null, matchesTaskNotesFormat: true, skipInlineParsing: true };
    }

    const statusValue = split.properties.status;
    const status = typeof statusValue === 'boolean'
        ? statusValue
        : typeof statusValue === 'string'
            ? statusValue
            : 'open';
    const mappedStatus = mapTaskNotesStatus(status);
    const tags = mapTaskNotesTags(readStringArray(split.properties.tags));
    const contexts = mapTaskNotesContexts(readStringArray(split.properties.contexts));
    const projects = mapTaskNotesProjects(readStringArray(split.properties.projects));
    const timeEstimateMinutes = typeof split.properties.timeEstimate === 'number' && Number.isFinite(split.properties.timeEstimate)
        ? split.properties.timeEstimate
        : null;

    return {
        matchesTaskNotesFormat: true,
        skipInlineParsing: true,
        task: {
            id: buildObsidianFileTaskId(normalizedRelativePath, 'tasknotes'),
            text: title,
            completed: mappedStatus.completed,
            tags,
            wikiLinks: extractObsidianWikiLinks(title),
            nestingLevel: 0,
            source: {
                vaultName: options.vaultName,
                vaultPath: options.vaultPath,
                relativeFilePath: normalizedRelativePath,
                lineNumber: 0,
                fileModifiedAt: options.fileModifiedAt,
                noteTags: tags,
            },
            format: 'tasknotes',
            taskNotesData: {
                rawStatus: mappedStatus.rawStatus,
                strideStatus: mappedStatus.strideStatus,
                priority: normalizeTaskNotesPriority(split.properties.priority),
                dueDate: parseTaskNotesDate(split.properties.due),
                scheduledDate: parseTaskNotesDate(split.properties.scheduled),
                contexts,
                projects,
                timeEstimateMinutes,
                recurrenceRule: typeof split.properties.recurrence === 'string' && split.properties.recurrence.trim()
                    ? split.properties.recurrence.trim()
                    : null,
                completedDate: parseTaskNotesDate(split.properties.completedDate),
                bodyPreview: extractBodyPreview(split.body),
            },
        },
    };
};
