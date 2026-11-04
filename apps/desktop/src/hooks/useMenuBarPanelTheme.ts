import { useEffect, useState } from 'react';
import { useTaskStore } from '@stride/core';
import {
    THEME_STORAGE_KEY,
    applyThemeMode,
    resolveDesktopThemeMode,
    resolveSystemThemeCommandPreference,
    watchNativeSystemThemePreference,
    watchSystemThemePreference,
} from '../lib/theme';
import { isTauriRuntime } from '../lib/runtime';

const readStoredTheme = (): string | null => {
    try {
        return window.localStorage.getItem(THEME_STORAGE_KEY);
    } catch {
        return null;
    }
};

/**
 * Keeps the menu bar panel on the main window's theme: the synced `settings.theme` (falling back
 * to the value the main window mirrors into localStorage), re-applied when settings change, when
 * the main window writes a new theme, and when the OS appearance flips (system modes).
 */
export function useMenuBarPanelTheme(): void {
    const settingsTheme = useTaskStore((state) => state.settings?.theme);
    const [storedTheme, setStoredTheme] = useState<string | null>(readStoredTheme);

    useEffect(() => {
        const onStorage = (event: StorageEvent) => {
            if (event.key === null || event.key === THEME_STORAGE_KEY) setStoredTheme(readStoredTheme());
        };
        const onFocus = () => setStoredTheme(readStoredTheme());
        window.addEventListener('storage', onStorage);
        window.addEventListener('focus', onFocus);
        return () => {
            window.removeEventListener('storage', onStorage);
            window.removeEventListener('focus', onFocus);
        };
    }, []);

    useEffect(() => {
        const mode = resolveDesktopThemeMode(settingsTheme, storedTheme);
        applyThemeMode(mode);
        if (mode !== 'system' && mode !== 'system-oled') return;
        let cancelled = false;
        if (isTauriRuntime()) {
            void resolveSystemThemeCommandPreference().then((theme) => {
                if (!cancelled && theme) applyThemeMode(mode, theme);
            });
        }
        const stopMedia = watchSystemThemePreference((theme) => applyThemeMode(mode, theme));
        const stopNative = isTauriRuntime()
            ? watchNativeSystemThemePreference(
                () => import('@tauri-apps/api/window'),
                (theme) => applyThemeMode(mode, theme),
            )
            : () => { };
        return () => {
            cancelled = true;
            stopMedia();
            stopNative();
        };
    }, [settingsTheme, storedTheme]);
}
