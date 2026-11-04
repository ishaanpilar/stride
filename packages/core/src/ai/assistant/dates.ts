import { safeParseDate } from '../../date';

const pad = (n: number) => String(n).padStart(2, '0');

export const toLocalDay = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const toLocalDateTime = (d: Date): string => `${toLocalDay(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export const startOfLocalDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export const addLocalDays = (d: Date, days: number): Date => {
    const next = new Date(d.getTime());
    next.setDate(next.getDate() + days);
    return next;
};

const INPUT = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2})?)?$/;

export type ParsedWhen = { ok: true; value: string; date: Date; hasTime: boolean } | { ok: false; error: string };

/** Accepts local `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm`. Rejects impossible/absurd/past dates. */
export function parseWhen(input: string, now: Date, options: { allowPast?: boolean } = {}): ParsedWhen {
    const match = INPUT.exec(input.trim());
    const hint = `Use local "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm". Current local time is ${toLocalDateTime(now)}.`;
    if (!match) return { ok: false, error: `"${input}" is not a valid date. ${hint}` };
    const hasTime = match[4] !== undefined;
    if (hasTime && (Number(match[4]) > 23 || Number(match[5]) > 59)) return { ok: false, error: `"${input}" has an invalid time. ${hint}` };
    const date = safeParseDate(`${match[1]}-${match[2]}-${match[3]}${hasTime ? `T${match[4]}:${match[5]}` : ''}`);
    if (!date) return { ok: false, error: `"${input}" is not a real calendar date. ${hint}` };
    if (!options.allowPast && startOfLocalDay(date) < startOfLocalDay(now)) {
        return { ok: false, error: `"${input}" is in the past (today is ${toLocalDay(now)}). Resolve relative dates against the current date.` };
    }
    if (date.getFullYear() > now.getFullYear() + 5) return { ok: false, error: `"${input}" is too far in the future. ${hint}` };
    const value = hasTime ? toLocalDateTime(date) : toLocalDay(date);
    return { ok: true, value, date, hasTime };
}

/** Day key (local) of a stored date string, or null. */
export function dayKeyOf(value: string | undefined | null): string | null {
    const d = safeParseDate(value ?? null);
    return d ? toLocalDay(d) : null;
}

export function hasTimeOf(value: string | undefined | null): boolean {
    return typeof value === 'string' && /T\d{2}:\d{2}/.test(value);
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Compact human label: "Fri 6 Nov, 17:00" or "Fri 6 Nov". */
export function formatWhen(value: string | undefined | null): string {
    const d = safeParseDate(value ?? null);
    if (!d) return '';
    const day = `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
    return hasTimeOf(value) ? `${day}, ${pad(d.getHours())}:${pad(d.getMinutes())}` : day;
}

/** Shift a stored date by N days, preserving date-only vs date-time. */
export function shiftWhen(value: string | undefined | null, days: number, fallbackBase: Date): string {
    const base = safeParseDate(value ?? null) ?? startOfLocalDay(fallbackBase);
    const shifted = addLocalDays(base, days);
    return hasTimeOf(value) ? toLocalDateTime(shifted) : toLocalDay(shifted);
}
