import { useState, type KeyboardEvent } from 'react';
import type { ChecklistItem } from '@stride/core';
import { Plus, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { isImeComposing } from '../../lib/ime';

interface FocusStepsProps {
    steps: ChecklistItem[];
    tr: (key: string, fallback: string) => string;
    onToggle: (id: string) => void;
    onRename: (id: string, title: string) => void;
    onRemove: (id: string) => void;
    onAdd: (title: string) => void;
}

const CHECK_PATH = 'M3.5 8.5l3 3 6-7';

export function FocusSteps({ steps, tr, onToggle, onRename, onRemove, onAdd }: FocusStepsProps) {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [justTicked, setJustTicked] = useState<string | null>(null);
    const [expanded, setExpanded] = useState(false);
    const [adding, setAdding] = useState(false);
    const [draft, setDraft] = useState('');
    const currentId = steps.find((s) => !s.isCompleted)?.id;
    const visible = expanded ? steps : steps.filter((s) => s.id === currentId || s.id === justTicked);
    const hidden = steps.length - visible.length;

    const tick = (step: ChecklistItem) => {
        if (!step.isCompleted) {
            setJustTicked(step.id);
            window.setTimeout(() => setJustTicked((cur) => (cur === step.id ? null : cur)), 900);
        }
        onToggle(step.id);
    };
    const submitDraft = () => {
        onAdd(draft);
        setDraft('');
    };
    const onAddKey = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter' && !isImeComposing(event)) {
            event.preventDefault();
            submitDraft();
        }
        if (event.key === 'Escape') {
            event.stopPropagation();
            setDraft('');
            setAdding(false);
        }
    };

    return (
        <div className="fx-checklist" data-testid="focus-checklist">
            {visible.length > 0 && (
                <ol className="fx-steps" aria-label={tr('focus.steps', 'Steps')}>
                    {visible.map((step) => (
                        <li
                            key={step.id}
                            className="fx-step group"
                            data-current={step.id === currentId ? 'true' : undefined}
                            data-done={step.isCompleted ? 'true' : undefined}
                            data-just={justTicked === step.id ? 'true' : undefined}
                        >
                            <button
                                type="button"
                                role="checkbox"
                                aria-checked={step.isCompleted}
                                aria-label={step.title}
                                onClick={() => tick(step)}
                                className="fx-check focus-ring"
                            >
                                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                    <path d={CHECK_PATH} />
                                </svg>
                            </button>
                            {editingId === step.id ? (
                                <input
                                    autoFocus
                                    defaultValue={step.title}
                                    aria-label={tr('focus.editStep', 'Edit step')}
                                    className="h-8 min-w-0 flex-1 rounded-control bg-well px-2 text-[15px] text-foreground focus-ring"
                                    onBlur={(e) => { onRename(step.id, e.currentTarget.value); setEditingId(null); }}
                                    onKeyDown={(e) => {
                                        if (isImeComposing(e)) return;
                                        if (e.key === 'Enter') e.currentTarget.blur();
                                        if (e.key === 'Escape') { e.stopPropagation(); setEditingId(null); }
                                    }}
                                />
                            ) : (
                                <button type="button" onClick={() => setEditingId(step.id)} title={tr('focus.editStep', 'Edit step')} className="fx-step-label focus-ring">
                                    <span>{step.title}</span>
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => onRemove(step.id)}
                                aria-label={tr('focus.removeStep', 'Remove step')}
                                title={tr('focus.removeStep', 'Remove step')}
                                className="fx-step-remove inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-well hover:text-foreground focus-ring"
                            >
                                <X className="h-3.5 w-3.5" aria-hidden />
                            </button>
                        </li>
                    ))}
                </ol>
            )}

            <div className={cn('flex flex-wrap items-center gap-x-1 gap-y-1', visible.length > 0 ? 'mt-0.5' : 'mt-2')}>
                {(hidden > 0 || expanded) && steps.length > 1 && (
                    <button type="button" className="fx-link fx-link--muted focus-ring" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
                        {expanded
                            ? tr('focus.showCurrent', 'Show only the current step')
                            : tr('focus.showAllSteps', 'Show all {{count}} steps').replace('{{count}}', String(steps.length))}
                    </button>
                )}
                {adding ? (
                    <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-control bg-well px-2 text-muted-foreground">
                        <Plus className="h-4 w-4 shrink-0" aria-hidden />
                        <input
                            autoFocus
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onKeyDown={onAddKey}
                            onBlur={() => { if (!draft.trim()) setAdding(false); }}
                            placeholder={tr('focus.addStep', 'Add a step')}
                            aria-label={tr('focus.addStep', 'Add a step')}
                            className="h-8 min-w-0 flex-1 bg-transparent text-[14px] text-foreground placeholder:text-muted-foreground focus:outline-none"
                        />
                    </label>
                ) : (
                    <button type="button" className="fx-link fx-link--muted inline-flex items-center gap-1 focus-ring" onClick={() => setAdding(true)}>
                        <Plus className="h-3.5 w-3.5" aria-hidden />{tr('focus.addStep', 'Add a step')}
                    </button>
                )}
            </div>
        </div>
    );
}
