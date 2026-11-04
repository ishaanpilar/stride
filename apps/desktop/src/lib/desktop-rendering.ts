import { invokeNativeOr } from './tauri-invoke';

export type DesktopRenderingConfig = {
    disableHardwareAcceleration: boolean;
};

const fallbackConfig = (): DesktopRenderingConfig => ({
    disableHardwareAcceleration: false,
});

export async function getDesktopRenderingConfig(): Promise<DesktopRenderingConfig> {
    return invokeNativeOr(fallbackConfig(), 'get_desktop_rendering_config');
}

export async function setDesktopRenderingConfig({
    disableHardwareAcceleration,
}: DesktopRenderingConfig): Promise<DesktopRenderingConfig> {
    return invokeNativeOr(fallbackConfig(), 'set_desktop_rendering_config', {
        disableHardwareAcceleration,
    });
}
