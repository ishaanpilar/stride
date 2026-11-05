import { invokeNative } from './tauri-invoke';

export const MENUBAR_PANEL_WINDOW_PARAM = 'menubarPanel';
export const MENUBAR_PANEL_MAIN_WINDOW_LABEL = 'main';
/** Emitted by Rust to the panel window each time it is shown. */
export const MENUBAR_PANEL_SHOWN_EVENT = 'menubar-panel-shown';
/** Emitted by Rust to the main window when the panel asks it to open a task or the Assistant. */
export const MENUBAR_OPEN_EVENT = 'menubar-open';
/** Emitted by the panel to the main window after it changed the shared Pomodoro snapshot. */
export const MENUBAR_POMODORO_CHANGED_EVENT = 'menubar-pomodoro-changed';
/** Emitted by the panel to the main window to bring Focus mode back to its full stage. */
export const MENUBAR_FOCUS_EXPAND_EVENT = 'menubar-focus-expand';
/** Emitted by the panel to the main window to show a view ("Review in Stride" opens the Inbox). */
export const MENUBAR_NAVIGATE_EVENT = 'menubar-navigate';

export type MenuBarNavigatePayload = { view: 'inbox' };

export type MenuBarOpenPayload = { taskId?: string | null; ask?: string | null; openCapture?: boolean };

export function isMenuBarPanelLocation(location: Pick<Location, 'search'> = window.location): boolean {
    const value = new URLSearchParams(location.search).get(MENUBAR_PANEL_WINDOW_PARAM);
    return value === '1' || value?.toLowerCase() === 'true';
}

export const hideMenuBarPanel = (): Promise<void> => invokeNative<void>('hide_menubar_panel');

/** macOS has no tray menu, so the panel carries its Lock and Quit actions. */
export const lockFromMenuBarPanel = (): Promise<void> => invokeNative<void>('menubar_lock');
export const quitFromMenuBarPanel = (): Promise<void> => invokeNative<void>('menubar_quit');

/** Shows the main window, optionally focused on a task, carrying text for the Assistant, or opening Quick Capture. */
export const openMainFromMenuBarPanel = (options: { taskId?: string; ask?: string; openCapture?: boolean } = {}): Promise<void> => (
    invokeNative<void>('menubar_open_main', {
        taskId: options.taskId ?? null,
        ask: options.ask ?? null,
        openCapture: options.openCapture === true,
    })
);

export const setTrayTitle = (title: string | null): Promise<void> => (
    invokeNative<void>('set_tray_title', { title })
);

/** Tells the main window to re-read data the panel just wrote (same event Quick Add uses). */
export async function notifyMainWindow(event: string, payload: unknown = {}): Promise<void> {
    const { emitTo } = await import('@tauri-apps/api/event');
    await emitTo(MENUBAR_PANEL_MAIN_WINDOW_LABEL, event, payload);
}
