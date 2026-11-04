import { MenuBarPanel } from './components/MenuBarPanel';
import { useMenuBarPanelTheme } from './hooks/useMenuBarPanelTheme';

/**
 * The panel window is transparent with native vibrancy behind it; this container is the visible
 * surface: rounded, hairline border, translucent so the vibrancy shows through.
 */
export function MenuBarPanelApp() {
    useMenuBarPanelTheme();
    return (
        <div className="h-screen p-0">
            <div className="h-full overflow-hidden rounded-xl border border-border/70 bg-background/75 text-foreground shadow-sm backdrop-blur-2xl backdrop-saturate-150">
                <MenuBarPanel />
            </div>
        </div>
    );
}
