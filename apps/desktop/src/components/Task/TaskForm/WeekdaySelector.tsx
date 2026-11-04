import { useMemo } from 'react';
import { buildRRuleString, getLocalizedWeekdayLabels, parseRRuleString, type RecurrenceWeekday } from '@stride/core';
import { cn } from '../../../lib/utils';
import { useLanguage } from '../../../contexts/language-context';

const WEEKDAYS: RecurrenceWeekday[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

type WeekdaySelectorProps = {
    value?: string;
    onChange: (rrule: string) => void;
    className?: string;
};

export function WeekdaySelector({ value, onChange, className }: WeekdaySelectorProps) {
    const { language } = useLanguage();
    const labels = useMemo(() => {
        const localizedLabels = getLocalizedWeekdayLabels(language, 'short');
        return WEEKDAYS.map((id) => ({
            id,
            label: localizedLabels[id] ?? id,
        }));
    }, [language]);
    const parsed = value ? parseRRuleString(value) : {};
    const selected = new Set<RecurrenceWeekday>(
        (parsed.byDay || []).filter((day) => WEEKDAYS.includes(day as RecurrenceWeekday)) as RecurrenceWeekday[]
    );

    const handleToggle = (day: RecurrenceWeekday) => {
        const next = new Set(selected);
        if (next.has(day)) {
            next.delete(day);
        } else {
            next.add(day);
        }
        const ordered = WEEKDAYS.filter((d) => next.has(d));
        onChange(buildRRuleString('weekly', ordered));
    };

    return (
        <div className={cn("flex flex-wrap gap-1", className)}>
            {labels.map((day) => {
                const isActive = selected.has(day.id);
                return (
                    <button
                        key={day.id}
                        type="button"
                        onClick={() => handleToggle(day.id)}
                        className={cn(
                            "text-[10px] px-2 py-1 rounded border transition-colors",
                            isActive
                                ? "bg-primary text-primary-foreground border-primary"
                                : "bg-transparent text-muted-foreground border-border hover:bg-accent"
                        )}
                        aria-pressed={isActive}
                    >
                        {day.label}
                    </button>
                );
            })}
        </div>
    );
}
