import { useEffect } from 'react';
import { openCapture } from '../lib/inline-capture';

/** Cmd/Ctrl+K: capture. In the Inbox it focuses the composer; elsewhere it opens the capture bar. */
export function useCaptureShortcut(): void {
    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
            if (event.code !== 'KeyK' && event.key.toLowerCase() !== 'k') return;
            if (event.defaultPrevented) return;
            event.preventDefault();
            openCapture({ fromTrigger: true });
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, []);
}
