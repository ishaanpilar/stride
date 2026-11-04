import { invokeNative } from './tauri-invoke';

export const getLaunchAtStartupEnabled = async (): Promise<boolean> => (
    invokeNative<boolean>('get_launch_at_startup_enabled')
);

export const setLaunchAtStartupEnabled = async (enabled: boolean): Promise<boolean> => (
    invokeNative<boolean>('set_launch_at_startup_enabled', { enabled })
);
