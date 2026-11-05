import { useEffect } from 'react';

/**
 * Cmd/Ctrl+Shift+J opens the Assistant panel and focuses its composer.
 * Cmd/Ctrl+\ toggles (collapses/expands) the panel.
 */
export function useAssistantShortcut(onOpen: () => void, onToggle?: () => void): void {
    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
            const key = event.key.toLowerCase();
            if (event.shiftKey && key === 'j') {
                event.preventDefault();
                onOpen();
            } else if (!event.shiftKey && key === '\\' && onToggle) {
                event.preventDefault();
                onToggle();
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [onOpen, onToggle]);
}
