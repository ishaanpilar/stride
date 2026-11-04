import { useEffect } from 'react';

/** Cmd/Ctrl+Shift+J opens the Assistant view. */
export function useAssistantShortcut(onOpen: () => void): void {
    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey) return;
            if (event.key.toLowerCase() !== 'j') return;
            event.preventDefault();
            onOpen();
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [onOpen]);
}
