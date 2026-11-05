import { MenuBarPanel } from './components/MenuBarPanel';
import { translateWithFallback } from '@stride/core';
import { PanelResizeHandle } from './components/menubar/PanelResizeHandle';
import { useLanguage } from './contexts/language-context';
import { useMenuBarPanelTheme } from './hooks/useMenuBarPanelTheme';
import { isMacRuntime } from './lib/runtime';

/**
 * On macOS the panel window is transparent with native vibrancy behind it; this container is the
 * visible surface: rounded, hairline border, translucent so the vibrancy shows through. Windows and
 * Linux windows are opaque (square corners), so the container paints a solid, square background there.
 */
export function MenuBarPanelApp() {
    useMenuBarPanelTheme();
    const { t } = useLanguage();
    const surface = isMacRuntime()
        ? 'rounded-xl bg-background/75 backdrop-blur-2xl backdrop-saturate-150'
        : 'bg-background';
    return (
        <div className="relative h-screen p-0">
            <div className={`h-full overflow-hidden border border-border/70 text-foreground shadow-sm ${surface}`}>
                <MenuBarPanel />
            </div>
            <PanelResizeHandle label={translateWithFallback(t, 'menubar.resizePanel', 'Resize panel')} />
        </div>
    );
}
