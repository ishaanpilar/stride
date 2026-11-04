import { useEffect } from 'react';
import { openQuickCapture } from '../lib/quick-capture-service';

/** Cmd/Ctrl+Shift+K opens the Quick Capture (AI mind sweep) dialog. */
export function useQuickCaptureShortcut(): void {
    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey) return;
            if (event.code !== 'KeyK') return;
            event.preventDefault();
            openQuickCapture();
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, []);
}
