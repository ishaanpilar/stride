import type { NotificationSettings, Task, TaskReminderPolicy } from './types';

export function normalizeTaskReminderPolicy(value: unknown): TaskReminderPolicy | undefined {
    return value === 'inherit' || value === 'send' || value === 'skip' ? value : undefined;
}

export function getTaskReminderPolicy(task: Pick<Task, 'reminderPolicy' | 'suppressStrideReminders'>): TaskReminderPolicy {
    const policy = normalizeTaskReminderPolicy(task.reminderPolicy);
    if (policy) return policy;
    return task.suppressStrideReminders === true ? 'skip' : 'send';
}

export function shouldSendTaskReminders(
    task: Pick<Task, 'reminderPolicy' | 'suppressStrideReminders'>,
    settings: Pick<NotificationSettings, 'taskReminderDefault'> = {},
): boolean {
    const policy = getTaskReminderPolicy(task);
    return policy === 'inherit' ? settings.taskReminderDefault !== 'skip' : policy === 'send';
}


export function getTaskReminderDefault(settings: Pick<NotificationSettings, 'taskReminderDefault'> = {}): 'send' | 'skip' {
    return settings.taskReminderDefault === 'skip' ? 'skip' : 'send';
}
