import { logWarn } from './app-log';
import { isTauriRuntime } from './runtime';

/**
 * True macOS full screen for the main window (Tauri `setFullscreen`, permission
 * core:window:allow-set-fullscreen). In a plain browser it falls back to the Fullscreen API.
 * Never throws; resolves to the state the window ended up in.
 */
export async function isWindowFullscreen(): Promise<boolean> {
    try {
        if (isTauriRuntime()) {
            const { getCurrentWindow } = await import('@tauri-apps/api/window');
            return await getCurrentWindow().isFullscreen();
        }
        return typeof document !== 'undefined' && Boolean(document.fullscreenElement);
    } catch {
        return false;
    }
}

export async function setWindowFullscreen(on: boolean): Promise<boolean> {
    try {
        if (isTauriRuntime()) {
            const { getCurrentWindow } = await import('@tauri-apps/api/window');
            const current = getCurrentWindow();
            await current.setFullscreen(on);
            return await current.isFullscreen();
        }
        if (typeof document === 'undefined') return false;
        if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen?.();
        if (!on && document.fullscreenElement) await document.exitFullscreen?.();
        return Boolean(document.fullscreenElement);
    } catch (error) {
        void logWarn('Full screen toggle failed', {
            scope: 'window',
            extra: { on, error: error instanceof Error ? error.message : String(error) },
        });
        return isWindowFullscreen();
    }
}
