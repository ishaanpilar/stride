import React from 'react';
import { X } from 'lucide-react';
import { Button } from '../../ui/Button';
import { cn } from '../../../lib/utils';

type BoardComposerProps = {
    placeholder: string;
    addLabel: string;
    cancelLabel: string;
    compact?: boolean;
    /** Called with the trimmed title. The composer stays open and clears itself for the next card. */
    onSubmit: (title: string) => void | Promise<void>;
    onClose: () => void;
};

/** Trello-style inline card composer: Enter adds and keeps the composer open, Escape or blur-while-empty closes it. */
export function BoardComposer({ placeholder, addLabel, cancelLabel, compact, onSubmit, onClose }: BoardComposerProps) {
    const [value, setValue] = React.useState('');
    const ref = React.useRef<HTMLTextAreaElement | null>(null);

    React.useLayoutEffect(() => {
        ref.current?.focus();
    }, []);
    React.useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = `${el.scrollHeight}px`;
    }, [value]);

    const submit = () => {
        const title = value.trim();
        if (!title) return;
        setValue('');
        void onSubmit(title);
        ref.current?.focus();
    };

    return (
        <form
            data-board-composer
            onSubmit={(event) => { event.preventDefault(); submit(); }}
            onBlur={(event) => {
                if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                if (!value.trim()) onClose();
            }}
            className="flex flex-col gap-2"
        >
            <div className={cn('rounded-card bg-card shadow-soft-sm focus-within:ring-2 focus-within:ring-ring', compact ? 'p-2.5' : 'p-3')}>
                <textarea
                    ref={ref}
                    rows={1}
                    value={value}
                    placeholder={placeholder}
                    aria-label={placeholder}
                    onChange={(event) => setValue(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                            event.preventDefault();
                            event.stopPropagation();
                            onClose();
                        } else if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                            event.preventDefault();
                            submit();
                        }
                    }}
                    className="block max-h-40 w-full resize-none overflow-y-auto border-0 bg-transparent p-0 text-[14px] font-semibold leading-5 text-foreground outline-none placeholder:font-normal placeholder:text-muted-foreground"
                />
            </div>
            <div className="flex items-center gap-1">
                <Button type="submit" size="xs" onMouseDown={(event) => event.preventDefault()}>
                    {addLabel}
                </Button>
                <button
                    type="button"
                    aria-label={cancelLabel}
                    title={cancelLabel}
                    onClick={onClose}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-control text-muted-foreground hover:bg-card hover:text-foreground focus-ring"
                >
                    <X className="h-4 w-4" aria-hidden="true" />
                </button>
            </div>
        </form>
    );
}
