import type { WindowSettings } from '@stride/core';

import { resolveCloseRequestAction } from './window-behavior';

type ClosePromptRef = {
    current: boolean;
};

type HandleDesktopCloseRequestOptions = {
    getWindowSettings: () => WindowSettings | undefined;
    hideToTray: () => Promise<void>;
    isFlatpak: boolean;
    logStep?: (step: string) => void;
    promptOpenRef: ClosePromptRef;
    quitApp: () => Promise<void>;
    reportCloseError: (label: string, error: unknown) => void;
    setPromptOpen: (next: boolean) => void;
    setPromptRemember: (next: boolean) => void;
};

export async function handleDesktopCloseRequest({
    getWindowSettings,
    hideToTray,
    isFlatpak,
    logStep,
    promptOpenRef,
    quitApp,
    reportCloseError,
    setPromptOpen,
    setPromptRemember,
}: HandleDesktopCloseRequestOptions): Promise<void> {
    const windowSettings = getWindowSettings();
    const closeAction = resolveCloseRequestAction(
        windowSettings?.closeBehavior,
        windowSettings?.showTray,
        isFlatpak,
    );
    logStep?.(`close action resolved to ${closeAction}`);

    if (closeAction === 'quit') {
        await quitApp().catch((error) => reportCloseError('Quit failed', error));
        return;
    }

    if (closeAction === 'tray') {
        await hideToTray().catch((error) => reportCloseError('Hide failed', error));
        return;
    }

    if (!promptOpenRef.current) {
        setPromptRemember(false);
        setPromptOpen(true);
    }
}
