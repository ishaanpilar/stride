/**
 * Adds the Windows x64 entry to a release's latest.json (run by .github/workflows/release-windows.yml).
 *
 *   bun scripts/add-windows-updater-entry.ts --manifest latest.json --version 1.6.0 \
 *     --signature-file Stride_1.6.0_x64-setup.exe.sig [--verify Stride_1.6.0_x64-setup.exe] [--out latest.json]
 *
 * The URL points at the NSIS installer uploaded to the same release; the signature is the contents
 * of the `.sig` file Tauri writes next to it when createUpdaterArtifacts is on. With --verify the
 * signature is checked against the public key in tauri.conf.json first, so a build signed with the
 * wrong key can never reach installed copies (they would refuse every update).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
    WINDOWS_UPDATER_TARGET,
    addUpdaterPlatform,
    isReleaseVersion,
    verifyUpdaterSignature,
    windowsSetupAssetName,
} from './updater-manifest';

const TAURI_CONFIG = resolve(import.meta.dir, '..', 'apps', 'desktop', 'src-tauri', 'tauri.conf.json');

type Options = { manifest: string; version: string; signatureFile: string; out: string; verify?: string; tauriConfig: string };

export function parseOptions(argv: string[]): Options {
    const values = new Map<string, string>();
    for (let index = 0; index < argv.length; index += 2) {
        const flag = argv[index];
        const value = argv[index + 1];
        if (!flag?.startsWith('--') || value === undefined) throw new Error(`Unexpected argument "${flag ?? ''}".`);
        values.set(flag.slice(2), value);
    }
    const manifest = values.get('manifest');
    const version = values.get('version')?.replace(/^v/, '');
    const signatureFile = values.get('signature-file');
    if (!manifest || !version || !signatureFile) {
        throw new Error('Usage: --manifest <latest.json> --version <X.Y.Z> --signature-file <setup.exe.sig> [--out <file>]');
    }
    if (!isReleaseVersion(version)) throw new Error(`Version must be X.Y.Z, got "${version}".`);
    return {
        manifest,
        version,
        signatureFile,
        out: values.get('out') ?? manifest,
        verify: values.get('verify'),
        tauriConfig: values.get('tauri-config') ?? TAURI_CONFIG,
    };
}

export function main(argv = process.argv.slice(2)): void {
    const options = parseOptions(argv);
    const signature = readFileSync(options.signatureFile, 'utf8').trim();
    if (options.verify) {
        const config = JSON.parse(readFileSync(options.tauriConfig, 'utf8')) as { plugins?: { updater?: { pubkey?: string } } };
        const publicKeyBase64 = config.plugins?.updater?.pubkey;
        if (!publicKeyBase64) throw new Error(`plugins.updater.pubkey is missing from ${options.tauriConfig}.`);
        const verified = verifyUpdaterSignature({ file: readFileSync(options.verify), signatureBase64: signature, publicKeyBase64 });
        if (!verified) throw new Error(`${options.verify} is not signed by the updater key in tauri.conf.json.`);
    }
    const manifest = JSON.parse(readFileSync(options.manifest, 'utf8')) as unknown;
    const updated = addUpdaterPlatform(manifest, {
        version: options.version,
        target: WINDOWS_UPDATER_TARGET,
        assetName: windowsSetupAssetName(options.version),
        signature,
    });
    writeFileSync(options.out, `${JSON.stringify(updated, null, 2)}\n`);
    console.log(`latest.json ${options.version}: ${Object.keys(updated.platforms).sort().join(', ')}`);
}

if (import.meta.main) {
    try {
        main();
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}
