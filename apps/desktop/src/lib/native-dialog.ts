import { withStrideDialog } from './app-lock';


type DialogPlugin = typeof import('@tauri-apps/plugin-dialog');

export const open = (async (options?: Parameters<DialogPlugin['open']>[0]) => {
    const dialog = await import('@tauri-apps/plugin-dialog');
    return withStrideDialog(() => dialog.open(options));
}) as DialogPlugin['open'];

export const save = (async (options?: Parameters<DialogPlugin['save']>[0]) => {
    const dialog = await import('@tauri-apps/plugin-dialog');
    return withStrideDialog(() => dialog.save(options));
}) as DialogPlugin['save'];
