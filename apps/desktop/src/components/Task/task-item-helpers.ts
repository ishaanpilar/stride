import {
    Task,
    TaskEditorFieldId,
    type TaskEditorSectionId,
    type RecurrenceRule,
    type RecurrenceStrategy,
    getRecurrenceRRuleValue,
    hasTimeComponent,
    safeFormatDate,
    safeParseDate,
    tFallback,
} from '@stride/core';
import { joinDateTime, splitDateTime } from '@stride/core/date-draft';

export { getRecurrenceRRuleValue };


export function findAttachmentsSection(
    schedulingFields: TaskEditorFieldId[],
    organizationFields: TaskEditorFieldId[],
    detailsFields: TaskEditorFieldId[],
): Extract<TaskEditorSectionId, 'scheduling' | 'organization' | 'details'> | null {
    if (schedulingFields.includes('attachments')) return 'scheduling';
    if (organizationFields.includes('attachments')) return 'organization';
    if (detailsFields.includes('attachments')) return 'details';
    return null;
}


export function toDateTimeLocalValue(dateStr: string | undefined): string {
    const { date, time } = splitDateTime(dateStr);
    return joinDateTime(date, time);
}

export function normalizeDateInputValue(value: string, now: Date = new Date()): string {
    const trimmed = String(value || '').trim();
    if (!trimmed) return '';

    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
    if (!match) return trimmed;

    const nowYear = now.getFullYear();
    const nowMonth = now.getMonth() + 1;
    const nowDay = now.getDate();

    let year = Number(match[1]);
    let month = Number(match[2]);
    let day = Number(match[3]);

    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
        return trimmed;
    }

    if (year === 0) year = nowYear;
    if (month === 0) month = nowMonth;
    if (day === 0) day = nowDay;

    if (month < 1 || month > 12) return trimmed;

    const maxDay = new Date(year, month, 0).getDate();
    if (day < 1) day = 1;
    if (day > maxDay) day = maxDay;

    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function getRecurrenceRuleValue(recurrence: Task['recurrence']): RecurrenceRule | '' {
    if (!recurrence) return '';
    if (typeof recurrence === 'string') return recurrence as RecurrenceRule;
    return recurrence.rule || '';
}

export function getRecurrenceStrategyValue(recurrence: Task['recurrence']): RecurrenceStrategy {
    if (recurrence && typeof recurrence === 'object' && recurrence.strategy === 'fluid') {
        return 'fluid';
    }
    return 'strict';
}


/**
 * Compact date chip label: "Today", "Tomorrow", "Yesterday" or "Sat, 8 Nov"
 * (year added when it is not the current year). Timed values append the time.
 */
export function formatTaskDateChipLabel(
    value: string | undefined,
    t: (key: string) => string,
    now: Date = new Date(),
): string {
    const parsed = safeParseDate(value);
    if (!parsed || !value) return '';
    const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const diffDays = Math.round((startOfDay(parsed) - startOfDay(now)) / 86_400_000);
    let day: string;
    if (diffDays === 0) day = tFallback(t, 'calendar.today', 'Today');
    else if (diffDays === 1) day = tFallback(t, 'calendar.tomorrow', 'Tomorrow');
    else if (diffDays === -1) day = tFallback(t, 'calendar.yesterday', 'Yesterday');
    else day = safeFormatDate(parsed, parsed.getFullYear() === now.getFullYear() ? 'EEE, d MMM' : 'EEE, d MMM yyyy');
    return hasTimeComponent(value) ? `${day}, ${safeFormatDate(value, 'p')}` : day;
}

/** i18n keys for task editor field names (same wording as Settings → Task Editor Layout). */
export const TASK_EDITOR_FIELD_LABEL_KEYS: Record<TaskEditorFieldId, string> = {
    status: 'taskEdit.statusLabel',
    project: 'taskEdit.projectLabel',
    section: 'taskEdit.sectionLabel',
    area: 'taskEdit.areaLabel',
    priority: 'taskEdit.priorityLabel',
    energyLevel: 'taskEdit.energyLevel',
    assignedTo: 'taskEdit.assignedTo',
    contexts: 'taskEdit.contextsLabel',
    tags: 'taskEdit.tagsLabel',
    location: 'taskEdit.locationLabel',
    timeEstimate: 'taskEdit.timeEstimateLabel',
    recurrence: 'taskEdit.recurrenceLabel',
    startTime: 'taskEdit.startDateLabel',
    dueDate: 'taskEdit.dueDateLabel',
    reviewAt: 'taskEdit.reviewDateLabel',
    description: 'taskEdit.descriptionLabel',
    textDirection: 'taskEdit.textDirectionLabel',
    attachments: 'attachments.title',
    checklist: 'taskEdit.checklist',
};
