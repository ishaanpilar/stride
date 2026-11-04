import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLanguage } from '../contexts/language-context';
import { useUiStore } from '../store/ui-store';
import { cn } from '../lib/utils';

export function ToastHost() {
    const { t } = useLanguage();
    const toasts = useUiStore((state) => state.toasts);
    const dismissToast = useUiStore((state) => state.dismissToast);
    const pauseToast = useUiStore((state) => state.pauseToast);
    const resumeToast = useUiStore((state) => state.resumeToast);
    const hostRef = useRef<HTMLDivElement>(null);
    const pointerInsideRef = useRef(false);
    const dismissLabel = t('common.dismiss');
    const dismissText = dismissLabel && dismissLabel !== 'common.dismiss' ? dismissLabel : 'Dismiss';

    useLayoutEffect(() => {
        if (toasts.length === 0) {
            pointerInsideRef.current = false;
            return;
        }
        if (pointerInsideRef.current || hostRef.current?.matches(':hover')) {
            pointerInsideRef.current = true;
            toasts.forEach((toast) => pauseToast(toast.id, 'pointer'));
        }
    }, [pauseToast, toasts]);

    useEffect(() => () => {
        const state = useUiStore.getState();
        state.toasts.forEach((toast) => {
            state.resumeToast(toast.id, 'pointer');
            state.resumeToast(toast.id, 'focus');
        });
    }, []);

    if (toasts.length === 0) return null;

    return (
        <div
            ref={hostRef}
            className="fixed bottom-4 right-4 z-50 flex flex-col gap-2"
            onPointerEnter={() => {
                pointerInsideRef.current = true;
                toasts.forEach((toast) => pauseToast(toast.id, 'pointer'));
            }}
            onPointerLeave={() => {
                pointerInsideRef.current = false;
                toasts.forEach((toast) => resumeToast(toast.id, 'pointer'));
            }}
        >
            {toasts.map((toast) => (
                <div
                    key={toast.id}
                    className={cn(
                        "min-w-[220px] max-w-[360px] rounded-card bg-popover px-4 py-3 text-sm text-popover-foreground shadow-soft flex items-start gap-3 animate-in fade-in slide-in-from-bottom-2",
                        toast.tone === 'success' && "ring-1 ring-success-fill/40",
                        toast.tone === 'error' && "ring-1 ring-danger/50",
                        toast.tone === 'info' && "ring-1 ring-border"
                    )}
                    role="status"
                    aria-live="polite"
                    onFocusCapture={() => pauseToast(toast.id, 'focus')}
                    onBlurCapture={(event) => {
                        const nextTarget = event.relatedTarget;
                        if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
                        resumeToast(toast.id, 'focus');
                    }}
                >
                    {toast.tone === 'success' && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success-text" aria-hidden="true" />}
                    {toast.tone === 'error' && <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger-text" aria-hidden="true" />}
                    <span className="flex-1">{toast.message}</span>
                    {toast.action && (
                        <button
                            type="button"
                            onClick={() => {
                                toast.action?.onClick();
                                dismissToast(toast.id);
                            }}
                            className="rounded-sm text-xs font-semibold text-accent-text hover:underline cursor-pointer focus-ring"
                        >
                            {toast.action.label}
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => dismissToast(toast.id)}
                        className="rounded-sm text-muted-foreground hover:text-foreground cursor-pointer transition-colors -mr-1 focus-ring"
                        aria-label={dismissText}
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                </div>
            ))}
        </div>
    );
}
