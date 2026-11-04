import { translateWithFallback } from '@stride/core';

import { reportError } from '../../../lib/report-error';

type Translate = (key: string) => string;

export function resolveSettingsFeedback(
    translate: Translate,
    key: string,
    fallback: string,
    values: Record<string, string | number> = {},
): string {
    let message = translateWithFallback(translate, key, fallback);
    Object.entries(values).forEach(([name, value]) => {
        message = message
            .split(`{{${name}}}`).join(String(value))
            .split(`{${name}}`).join(String(value));
    });
    return message;
}

export function reportSettingsFailure(
    label: string,
    error: unknown,
    userMessage: string,
    options?: { toast?: boolean },
) {
    reportError(label, error, {
        toast: options?.toast,
        userMessage,
    });
}
