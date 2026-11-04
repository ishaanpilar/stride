import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { PillTone } from './Pill';

type MetadataVariant = 'project' | 'context' | 'tag' | 'priority' | 'estimate' | 'age' | 'info';

interface MetadataBadgeProps {
    label: string;
    variant: MetadataVariant;
    icon?: LucideIcon;
    dotColor?: string;
    className?: string;
    ariaLabel?: string;
    /** Soft pill tone (default neutral). Meaning is always carried by the text, never colour alone. */
    tone?: PillTone;
    /** Extra visible text after the label, e.g. ", overdue". */
    suffix?: string;
    /** Tooltip, e.g. the full date behind a short date label. */
    title?: string;
}

const toneClasses: Record<PillTone, string> = {
    neutral: 'bg-well text-muted-foreground',
    accent: 'bg-accent-soft text-accent-text',
    today: 'today-pill',
    danger: 'bg-danger/10 text-danger-text',
    warning: 'bg-warning-fill/10 text-warning-text',
    success: 'bg-success-fill/10 text-success-text',
};

/** Soft 26px chip used in task rows (project, date, context, tag, priority...). */
export function MetadataBadge({ label, variant, icon: Icon, dotColor, className, ariaLabel, tone = 'neutral', suffix, title }: MetadataBadgeProps) {
    return (
        <span
            className={cn(
                'metadata-badge h-[26px] gap-1.5 px-2.5 py-0 text-xs font-medium leading-4 normal-case tracking-normal',
                `metadata-badge--${variant}`,
                toneClasses[tone],
                className,
            )}
            title={title}
            aria-label={ariaLabel ?? (suffix ? `${label}${suffix}` : label)}
        >
            {dotColor && (
                <span
                    className="metadata-badge__dot !h-2 !w-2"
                    style={{ backgroundColor: dotColor }}
                    aria-hidden="true"
                />
            )}
            {Icon && <Icon className="metadata-badge__icon !h-3.5 !w-3.5" aria-hidden="true" />}
            {/* Label and suffix share one text run so the gap never splits "Yesterday, overdue". */}
            <span className="metadata-badge__label">
                {label}
                {suffix ? <span className="metadata-badge__suffix">{suffix}</span> : null}
            </span>
        </span>
    );
}
