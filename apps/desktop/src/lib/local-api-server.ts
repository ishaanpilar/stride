import { invokeNativeOr } from './tauri-invoke';

export const DEFAULT_LOCAL_API_PORT = 3456;

export type LocalApiServerStatus = {
    enabled: boolean;
    running: boolean;
    port: number;
    url?: string | null;
    token?: string | null;
    error?: string | null;
};

const fallbackStatus = (): LocalApiServerStatus => ({
    enabled: false,
    running: false,
    port: DEFAULT_LOCAL_API_PORT,
    url: null,
    token: null,
    error: null,
});

export async function getLocalApiServerStatus(): Promise<LocalApiServerStatus> {
    return invokeNativeOr(fallbackStatus(), 'get_local_api_server_status');
}

export async function setLocalApiServerConfig({
    enabled,
    port,
}: {
    enabled: boolean;
    port: number;
}): Promise<LocalApiServerStatus> {
    return invokeNativeOr(fallbackStatus(), 'set_local_api_server_config', {
        enabled,
        port,
    });
}

export function normalizeLocalApiPortInput(value: string): number | null {
    const port = Number(value);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
        return null;
    }
    return port;
}
