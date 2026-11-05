import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Loader2, Scissors, Sparkles } from 'lucide-react';
import {
    PROJECT_TITLE_SOFT_LIMIT,
    buildNotesWithOriginalTitle,
    isProjectTitleLong,
    tFallback,
    useTaskStore,
    type Project,
    type ShortenProjectTitleResult,
} from '@stride/core';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '../../ui/Dialog';
import { Button } from '../../ui/Button';
import { useDocumentationLanguage } from '../../../contexts/language-context';
import { shortenProjectTitle } from '../../../lib/project-title-service';
import { showUndoToast } from '../../../lib/undo-registry';
import { reportError } from '../../../lib/report-error';
import { cn } from '../../../lib/utils';

type Translate = (key: string) => string;

/** Label and icon for the "Shorten" action: Sparkles + "Shorten with AI" when AI is on, else the heuristic. */
export function getShortenTitleAction(t: Translate, aiEnabled: boolean): { label: string; icon: typeof Sparkles } {
    return aiEnabled
        ? { label: tFallback(t, 'projects.shortenTitleAi', 'Shorten with AI'), icon: Sparkles }
        : { label: tFallback(t, 'projects.shortenTitle', 'Shorten title'), icon: Scissors };
}

/**
 * Soft limit hint under a project title input once it passes PROJECT_TITLE_SOFT_LIMIT characters.
 * Never blocks; optionally offers the Shorten action.
 */
export function ProjectTitleLengthHint({
    title,
    t,
    id,
    onShorten,
    aiEnabled = false,
    className,
}: {
    title: string;
    t: Translate;
    id?: string;
    onShorten?: () => void;
    aiEnabled?: boolean;
    className?: string;
}) {
    if (!isProjectTitleLong(title)) return null;
    const action = getShortenTitleAction(t, aiEnabled);
    const Icon = action.icon;
    return (
        <p id={id} data-project-title-hint className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-4 text-muted-foreground', className)}>
            <span>{tFallback(t, 'projects.titleLengthHint', 'Shorter names are easier to scan: put details in the project notes')}</span>
            {onShorten && (
                <button
                    type="button"
                    onClick={onShorten}
                    className="focus-ring inline-flex items-center gap-1 rounded-control px-1.5 py-0.5 font-medium text-accent-text hover:bg-accent-soft"
                >
                    <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    {action.label}
                </button>
            )}
        </p>
    );
}

interface ShortenProjectTitleDialogProps {
    project: Project;
    aiEnabled: boolean;
    t: Translate;
    onClose: () => void;
    onApply: (title: string, moveToNotes: boolean) => void;
    /** Injected in tests; defaults to the AI service (which falls back to the heuristic). */
    suggest?: (title: string, notes?: string) => Promise<ShortenProjectTitleResult>;
}

export function ShortenProjectTitleDialog({ project, aiEnabled, t, onClose, onApply, suggest }: ShortenProjectTitleDialogProps) {
    const language = useDocumentationLanguage();
    const titleId = useId();
    const inputId = useId();
    const hintId = useId();
    const [loading, setLoading] = useState(true);
    const [value, setValue] = useState('');
    const [source, setSource] = useState<ShortenProjectTitleResult['source'] | null>(null);
    const [moveToNotes, setMoveToNotes] = useState(true);
    const inputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        let cancelled = false;
        const run = suggest ?? ((title: string, notes?: string) => shortenProjectTitle(title, notes, language));
        setLoading(true);
        void run(project.title, project.supportNotes).then((result) => {
            if (cancelled) return;
            setValue(result.title);
            setSource(result.source);
            setLoading(false);
            window.requestAnimationFrame?.(() => inputRef.current?.select());
        });
        return () => { cancelled = true; };
    }, [project.id, project.title, project.supportNotes, suggest, language]);

    const trimmed = value.trim();
    const canApply = !loading && trimmed.length > 0 && trimmed !== project.title.trim();
    const action = getShortenTitleAction(t, aiEnabled);
    const Icon = action.icon;

    const submit = (event: FormEvent) => {
        event.preventDefault();
        if (!canApply) return;
        onApply(trimmed, moveToNotes);
    };

    return (
        <Dialog onClose={onClose} labelledBy={titleId} placement="top" overlayClassName="pt-[15vh]" panelClassName="max-w-md">
            <form onSubmit={submit} data-testid="shorten-project-title-dialog">
                <DialogHeader className="flex items-center gap-2 px-5 pt-4 pb-2">
                    <Icon className="h-4 w-4 shrink-0 text-accent-text" aria-hidden="true" />
                    <h3 id={titleId} className="text-[17px] font-semibold">{action.label}</h3>
                </DialogHeader>
                <DialogBody className="space-y-3 px-5 pb-3">
                    <p className="break-words text-[13px] leading-[17px] text-muted-foreground">{project.title}</p>
                    <label htmlFor={inputId} className="block text-xs font-medium text-muted-foreground">
                        {tFallback(t, 'projects.shortenTitleSuggestion', 'New title')}
                    </label>
                    <div className="relative">
                        <input
                            ref={inputRef}
                            id={inputId}
                            type="text"
                            value={value}
                            onChange={(event) => setValue(event.target.value)}
                            disabled={loading}
                            aria-busy={loading}
                            aria-describedby={hintId}
                            className="h-9 w-full rounded-control bg-well px-3 text-sm text-foreground focus-ring disabled:opacity-60"
                        />
                        {loading && <Loader2 className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden="true" />}
                    </div>
                    <p id={hintId} className="text-xs text-muted-foreground" aria-live="polite">
                        {loading
                            ? tFallback(t, 'common.loading', 'Loading...')
                            : `${trimmed.length}/${PROJECT_TITLE_SOFT_LIMIT}`}
                        {!loading && aiEnabled && source === 'fallback' && (
                            <> · {tFallback(t, 'projects.shortenTitleFallback', 'AI unavailable, trimmed to the first clause')}</>
                        )}
                    </p>
                    <label className="flex items-start gap-2 text-sm text-foreground">
                        <input
                            type="checkbox"
                            className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
                            checked={moveToNotes}
                            onChange={(event) => setMoveToNotes(event.target.checked)}
                        />
                        <span>{tFallback(t, 'projects.shortenTitleMoveToNotes', 'Move the full title into the project notes')}</span>
                    </label>
                </DialogBody>
                <DialogFooter className="flex justify-end gap-2 px-5 pb-4 pt-1">
                    <Button type="button" variant="secondary" onClick={onClose}>{tFallback(t, 'common.cancel', 'Cancel')}</Button>
                    <Button type="submit" disabled={!canApply}>{tFallback(t, 'common.save', 'Save')}</Button>
                </DialogFooter>
            </form>
        </Dialog>
    );
}

/**
 * Wires the Shorten action for one project: opens the dialog, applies the new title (and moves the
 * original into the notes when asked), and offers Undo.
 */
export function useProjectTitleShortener({
    project,
    t,
    onApplied,
    updateProject,
}: {
    project: Project | null | undefined;
    t: Translate;
    onApplied?: (title: string) => void;
    updateProject?: (id: string, updates: Partial<Project>) => unknown;
}): { open: () => void; aiEnabled: boolean; dialog: ReactNode } {
    const [isOpen, setIsOpen] = useState(false);
    const aiEnabled = useTaskStore((state) => state.settings?.ai?.enabled === true);
    const open = useCallback(() => setIsOpen(true), []);
    const close = useCallback(() => setIsOpen(false), []);

    const apply = useCallback((title: string, moveToNotes: boolean) => {
        if (!project) return;
        const update = updateProject ?? useTaskStore.getState().updateProject;
        const previous = { title: project.title, supportNotes: project.supportNotes };
        const next: Partial<Project> = { title };
        if (moveToNotes) next.supportNotes = buildNotesWithOriginalTitle(project.supportNotes, project.title);
        setIsOpen(false);
        Promise.resolve(update(project.id, next)).then(() => {
            onApplied?.(title);
            showUndoToast(tFallback(t, 'projects.shortenTitleDone', 'Title shortened'), () => {
                const restore: Partial<Project> = { title: previous.title };
                if (moveToNotes) restore.supportNotes = previous.supportNotes ?? '';
                Promise.resolve(update(project.id, restore)).then(() => onApplied?.(previous.title)).catch((error) => {
                    reportError('Failed to undo project title shortening', error);
                });
            }, t);
        }).catch((error) => reportError('Failed to shorten project title', error));
    }, [onApplied, project, t, updateProject]);

    const dialog = isOpen && project
        ? <ShortenProjectTitleDialog project={project} aiEnabled={aiEnabled} t={t} onClose={close} onApply={apply} />
        : null;
    return { open, aiEnabled, dialog };
}
