import { useEffect, useMemo, useState } from 'react';
import {
    countMenuBarPanelTasks,
    useTaskStore,
    type Language,
} from '@stride/core';
import { resolveTaskNavigationView } from '../lib/task-navigation';
import { dispatchNavigateEvent, type DesktopViewId } from '../lib/navigation-events';
import {
    MENUBAR_FOCUS_EXPAND_EVENT,
    MENUBAR_OPEN_EVENT,
    MENUBAR_POMODORO_CHANGED_EVENT,
    setTrayTitle,
    type MenuBarOpenPayload,
} from '../lib/menubar-panel-window';
import { openQuickCapture } from '../lib/quick-capture-service';
import { useAppLockStore } from '../lib/app-lock';
import { logError } from '../lib/app-log';
import { isTauriRuntime } from '../lib/runtime';
import { useAssistantStore } from '../store/assistant-store';
import { usePomodoroStore } from '../store/pomodoro-store';
import { useFocusSessionStore } from '../store/focus-session-store';

/** Time for the Assistant view to mount and hydrate its thread before a question is sent. */
const ASSISTANT_MOUNT_DELAY_MS = 250;

/**
 * Main-window side of the macOS menu bar panel: handles "open task" / "ask" requests from the
 * panel, re-reads the Pomodoro snapshot the panel changed, and keeps the tray count in sync.
 */
export function useMenuBarPanelBridge({ enabled, language }: { enabled: boolean; language: Language }): void {
    useEffect(() => {
        if (!enabled || !isTauriRuntime()) return;
        let disposed = false;
        const unlisteners: Array<() => void> = [];
        const setup = async () => {
            const { listen } = await import('@tauri-apps/api/event');
            const offOpen = await listen<MenuBarOpenPayload>(MENUBAR_OPEN_EVENT, (event) => {
                const { taskId, ask, openCapture } = event.payload ?? {};
                if (openCapture) {
                    openQuickCapture();
                    return;
                }
                if (ask && ask.trim()) {
                    dispatchNavigateEvent('assistant' as DesktopViewId);
                    window.setTimeout(() => {
                        void useAssistantStore.getState().send(ask, language);
                    }, ASSISTANT_MOUNT_DELAY_MS);
                    return;
                }
                if (taskId) {
                    const task = useTaskStore.getState()._allTasks.find((candidate) => candidate.id === taskId);
                    if (!task) return;
                    useTaskStore.getState().setHighlightTask(taskId);
                    dispatchNavigateEvent(resolveTaskNavigationView(task));
                }
            });
            const offPomodoro = await listen(MENUBAR_POMODORO_CHANGED_EVENT, () => {
                const { settings } = useTaskStore.getState();
                usePomodoroStore.getState().hydratePomodoro({
                    autoStartBreaks: settings.gtd?.pomodoro?.autoStartBreaks === true,
                    autoStartFocus: settings.gtd?.pomodoro?.autoStartFocus === true,
                });
            });
            const offFocus = await listen(MENUBAR_FOCUS_EXPAND_EVENT, () => {
                useFocusSessionStore.getState().expand();
            });
            if (disposed) {
                offOpen();
                offPomodoro();
                offFocus();
                return;
            }
            unlisteners.push(offOpen, offPomodoro, offFocus);
        };
        setup().catch((error) => void logError(error, { scope: 'menubar', step: 'listen' }));
        return () => {
            disposed = true;
            unlisteners.forEach((off) => off());
        };
    }, [enabled, language]);

    const tasks = useTaskStore((state) => state.tasks);
    const projects = useTaskStore((state) => state.projects);
    const showCount = useTaskStore((state) => state.settings?.window?.showTrayCount !== false);
    const locked = useAppLockStore((state) => state.locked);
    const [minuteTick, setMinuteTick] = useState(0);

    useEffect(() => {
        if (!enabled) return;
        const id = window.setInterval(() => setMinuteTick((value) => value + 1), 60_000);
        return () => window.clearInterval(id);
    }, [enabled]);

    const count = useMemo(() => {
        void minuteTick;
        return countMenuBarPanelTasks(tasks, { projects });
    }, [tasks, projects, minuteTick]);

    useEffect(() => {
        if (!enabled || !isTauriRuntime()) return;
        const title = showCount && !locked && count > 0 ? String(count) : null;
        setTrayTitle(title).catch((error) => void logError(error, { scope: 'tray', step: 'setTitle' }));
    }, [count, enabled, locked, showCount]);
}

