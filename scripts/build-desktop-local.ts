import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const desktopDir = resolve(import.meta.dir, '..', 'apps', 'desktop');
const localConfig = join('src-tauri', 'tauri.local.conf.json');
const updaterConfig = join('src-tauri', 'tauri.updater.conf.json');

export function buildLocalTauriArgs(env: NodeJS.ProcessEnv, extraArgs: string[]): string[] {
    const args = ['tauri', 'build', '--config', localConfig];
    if (env.TAURI_SIGNING_PRIVATE_KEY?.trim()) args.push('--config', updaterConfig);
    return [...args, ...extraArgs];
}

if (import.meta.main) {
    const args = buildLocalTauriArgs(process.env, process.argv.slice(2));
    if (!args.includes(updaterConfig)) {
        console.log('TAURI_SIGNING_PRIVATE_KEY is not set: building without signed updater artifacts (dev build).');
    } else {
        console.log('Signing updater artifacts with TAURI_SIGNING_PRIVATE_KEY.');
    }
    const result = spawnSync('bunx', args, { cwd: desktopDir, stdio: 'inherit', env: process.env });
    process.exit(result.status ?? 1);
}
