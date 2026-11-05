import { MenuBarPanel } from './components/MenuBarPanel';
import { translateWithFallback } from '@stride/core';
import { PanelResizeHandle } from './components/menubar/PanelResizeHandle';
import { useLanguage } from './contexts/language-context';
import { useMenuBarPanelTheme } from './hooks/useMenuBarPanelTheme';

/**
 * The panel window is transparent with native vibrancy behind it; this container is the visible
 * surface: rounded, hairline border, translucent so the vibrancy shows through.
 */
export function MenuBarPanelApp() {
    useMenuBarPanelTheme();
    const { t } = useLanguage();
    return (
        <div className="relative h-screen p-0">
            <div className="h-full overflow-hidden rounded-xl border border-border/70 bg-background/75 text-foreground shadow-sm backdrop-blur-2xl backdrop-saturate-150">
                <MenuBarPanel />
            </div>
            <PanelResizeHandle label={translateWithFallback(t, 'menubar.resizePanel', 'Resize panel')} />
        </div>
    );
}
