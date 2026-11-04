import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
    DEFAULT_TASKNOTES_FOLDER,
    parseTaskNotesFile,
    type ParseTaskNotesFileOptions,
} from './tasknotes-parser';

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'obsidian-test-vault');

const readFixture = (relativePath: string): string => {
    return readFileSync(join(fixtureRoot, relativePath), 'utf8');
};

const createOptions = (relativeFilePath: string, overrides?: Partial<ParseTaskNotesFileOptions>): ParseTaskNotesFileOptions => ({
    vaultName: 'TestVault',
    vaultPath: '/tmp/TestVault',
    relativeFilePath,
    fileModifiedAt: '2026-03-31T12:00:00.000Z',
    includeArchived: false,
    ...overrides,
});

describe('parseTaskNotesFile', () => {
    it('parses rich TaskNotes frontmatter into a single task', () => {
        const result = parseTaskNotesFile(
            readFixture('TaskNotes/Review quarterly report.md'),
            createOptions('TaskNotes/Review quarterly report.md')
        );

        expect(result.matchesTaskNotesFormat).toBe(true);
        expect(result.task).toMatchObject({
            text: 'Review quarterly report',
            completed: false,
            format: 'tasknotes',
            tags: ['work'],
            wikiLinks: [],
            source: {
                relativeFilePath: 'TaskNotes/Review quarterly report.md',
                lineNumber: 0,
            },
            taskNotesData: {
                rawStatus: 'in-progress',
                strideStatus: 'next',
                priority: 'high',
                dueDate: '2025-01-15',
                scheduledDate: '2025-01-14',
                contexts: ['office'],
                projects: ['Q1 Planning'],
                timeEstimateMinutes: 120,
                recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO',
            },
        });
        expect(result.task?.taskNotesData?.bodyPreview).toContain('Key points to review');
    });

    it('falls back to the filename when the frontmatter title is missing', () => {
        const result = parseTaskNotesFile(
            readFixture('TaskNotes/Buy groceries.md'),
            createOptions('TaskNotes/Buy groceries.md')
        );

        expect(result.task?.text).toBe('Buy groceries');
        expect(result.task?.taskNotesData?.contexts).toEqual(['home']);
        expect(result.task?.taskNotesData?.projects).toEqual(['Home']);
        expect(result.task?.tags).toEqual(['errands']);
    });

    it('maps boolean status values to completed state', () => {
        const result = parseTaskNotesFile(
            readFixture('TaskNotes/Boolean status.md'),
            createOptions('TaskNotes/Boolean status.md')
        );

        expect(result.task?.completed).toBe(true);
        expect(result.task?.taskNotesData?.strideStatus).toBe('done');
        expect(result.task?.taskNotesData?.completedDate).toBe('2025-01-20');
    });

    it('accepts ISO-style date-time values in TaskNotes frontmatter', () => {
        const result = parseTaskNotesFile(
            [
                '---',
                'tags:',
                '  - task',
                'title: Sync with partner',
                'status: open',
                'due: 2025-01-15T08:30:00Z',
                'scheduled: 2025-01-14 09:00:00',
                'completedDate: 2025-01-16T17:45:00-05:00',
                '---',
            ].join('\n'),
            createOptions('TaskNotes/Sync with partner.md')
        );

        expect(result.task?.taskNotesData?.dueDate).toBe('2025-01-15T08:30:00Z');
        expect(result.task?.taskNotesData?.scheduledDate).toBe('2025-01-14 09:00:00');
        expect(result.task?.taskNotesData?.completedDate).toBe('2025-01-16T17:45:00-05:00');
    });

    it('skips archived TaskNotes files by default but still flags the format', () => {
        const result = parseTaskNotesFile(
            readFixture('TaskNotes/Archive/Old task.md'),
            createOptions('TaskNotes/Archive/Old task.md')
        );

        expect(result.matchesTaskNotesFormat).toBe(true);
        expect(result.task).toBeNull();
    });

    it('includes archived TaskNotes files when requested', () => {
        const result = parseTaskNotesFile(
            readFixture('TaskNotes/Archive/Old task.md'),
            createOptions('TaskNotes/Archive/Old task.md', { includeArchived: true })
        );

        expect(result.task?.text).toBe('Archived task');
        expect(result.task?.completed).toBe(true);
        expect(result.task?.taskNotesData?.priority).toBe('medium');
    });

    it('ignores generated view files', () => {
        const result = parseTaskNotesFile(
            readFixture('TaskNotes/Views/tasks-default.md'),
            createOptions('TaskNotes/Views/tasks-default.md')
        );

        expect(result).toEqual({
            task: null,
            matchesTaskNotesFormat: false,
            skipInlineParsing: true,
        });
    });

    it('does not treat regular markdown notes as TaskNotes files', () => {
        const result = parseTaskNotesFile(
            readFixture('Projects/Alpha.md'),
            createOptions('Projects/Alpha.md')
        );

        expect(result).toEqual({
            task: null,
            matchesTaskNotesFormat: false,
            skipInlineParsing: false,
        });
    });

    it('uses the shared default folder constant for tasknotes creation fallback', () => {
        expect(DEFAULT_TASKNOTES_FOLDER).toBe('TaskNotes');
    });

    it('ignores inline checklist items in the task body', () => {
        const result = parseTaskNotesFile(
            [
                '---',
                'tags:',
                '  - task',
                'title: Review rollout',
                'status: open',
                '---',
                '- [ ] body checkbox',
                '- [x] another checkbox',
            ].join('\n'),
            createOptions('TaskNotes/Review rollout.md')
        );

        expect(result.task?.text).toBe('Review rollout');
        expect(result.task?.taskNotesData?.bodyPreview).toContain('body checkbox');
    });
});
