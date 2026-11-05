import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';

import {
    MAC_UPDATER_TARGET,
    UPDATER_REPO,
    buildLatestJson,
    isReleaseVersion,
    macInstallZipName,
    macUpdaterAssetName,
    minisignKeyId,
    validateLatestJson,
    verifyUpdaterSignature,
} from './updater-manifest';

const repoRoot = resolve(import.meta.dir, '..');
const desktopDir = join(repoRoot, 'apps', 'desktop');
const bundleDir = join(desktopDir, 'src-tauri', 'target', 'release', 'bundle', 'macos');
const tauriConfigPath = join(desktopDir, 'src-tauri', 'tauri.conf.json');
const KEYCHAIN_ACCOUNT = 'stride-updater';
const KEYCHAIN_SERVICE = 'Stride updater signing key';
const DEFAULT_KEY_PATH = join(homedir(), '.tauri', 'stride-updater.key');
const DEFAULT_SIGNING_IDENTITY = 'CloseQuit Local';
const PUBLIC_REMOTE = 'stride';
const PUBLIC_BRANCH = 'main';
const LOCAL_ONLY_PATHS = new Set(['CLAUDE.md']);

type Options = {
    version: string;
    notesFile: string | null;
    outDir: string;
    publish: boolean;
    skipBuild: boolean;
    allowDirty: boolean;
};

const USAGE = `Usage: bun scripts/release-mac.ts <X.Y.Z> [--notes-file <path>] [--out <dir>] [--skip-build] [--allow-dirty] [--publish]

Builds Stride for Apple silicon, signs the updater bundle, writes latest.json and SHA256SUMS.txt,
verifies the signature, and prints the gh release command. Nothing is pushed unless --publish is given.`;

function fail(message: string): never {
    console.error(`release-mac: ${message}`);
    process.exit(1);
}

function parseOptions(argv: string[]): Options {
    const options: Options = {
        version: '',
        notesFile: null,
        outDir: '',
        publish: false,
        skipBuild: false,
        allowDirty: false,
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--publish') options.publish = true;
        else if (arg === '--skip-build') options.skipBuild = true;
        else if (arg === '--allow-dirty') options.allowDirty = true;
        else if (arg === '--notes-file') options.notesFile = resolve(argv[++index] ?? fail('--notes-file needs a path'));
        else if (arg === '--out') options.outDir = resolve(argv[++index] ?? fail('--out needs a directory'));
        else if (arg === '--help' || arg === '-h') {
            console.log(USAGE);
            process.exit(0);
        } else if (!options.version && !arg.startsWith('--')) options.version = arg.replace(/^v/, '');
        else fail(`unknown argument ${arg}\n\n${USAGE}`);
    }
    if (!isReleaseVersion(options.version)) fail(`a version X.Y.Z is required.\n\n${USAGE}`);
    if (options.publish && options.allowDirty) fail('--publish cannot be combined with --allow-dirty.');
    options.outDir ||= join(repoRoot, 'dist', 'release', `v${options.version}`);
    return options;
}

function run(command: string, args: string[], options: SpawnSyncOptions = {}): string {
    const result = spawnSync(command, args, { cwd: repoRoot, encoding: 'utf8', ...options });
    if (result.status !== 0) {
        const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : '';
        fail(`${command} ${args[0] ?? ''} failed${stderr ? `: ${stderr}` : ''}`);
    }
    return typeof result.stdout === 'string' ? result.stdout.trim() : '';
}

function dirtyPaths(): string[] {
    return run('git', ['status', '--porcelain'])
        .split('\n')
        .filter(Boolean)
        // `run` trims the output, so the first line may have lost its leading space: strip the status code by pattern.
        .map((line) => line.replace(/^[ MADRCUT?!]{1,2} +/, '').trim())
        .filter((path) => !LOCAL_ONLY_PATHS.has(path));
}

function ensureCleanTree(options: Options, stage: string): void {
    const dirty = dirtyPaths();
    if (dirty.length === 0) return;
    if (options.allowDirty) {
        console.warn(`Warning (${stage}): working tree has changes: ${dirty.join(', ')}`);
        return;
    }
    fail(`working tree is not clean (${stage}): ${dirty.join(', ')}. Commit first, or pass --allow-dirty for a dry run.`);
}

function readKeychainPassword(): string {
    const result = spawnSync('security', ['find-generic-password', '-a', KEYCHAIN_ACCOUNT, '-s', KEYCHAIN_SERVICE, '-w'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
    });
    const password = result.status === 0 ? result.stdout.replace(/\n$/, '') : '';
    if (!password) fail(`no keychain item "${KEYCHAIN_SERVICE}" (account ${KEYCHAIN_ACCOUNT}). See docs/development/releasing.md.`);
    return password;
}

function readPublicKey(): string {
    const config = JSON.parse(readFileSync(tauriConfigPath, 'utf8')) as { plugins?: { updater?: { pubkey?: string } } };
    const pubkey = config.plugins?.updater?.pubkey;
    if (!pubkey) fail('plugins.updater.pubkey is missing from tauri.conf.json.');
    return pubkey;
}

function setVersion(version: string): void {
    const current = (JSON.parse(readFileSync(join(desktopDir, 'package.json'), 'utf8')) as { version: string }).version;
    if (current === version) {
        console.log(`Version is already ${version}.`);
        return;
    }
    console.log(`Setting version ${current} -> ${version}.`);
    run('bun', ['scripts/set-version.ts', version], { stdio: 'inherit' });
}

function build(keyPath: string): void {
    const password = readKeychainPassword();
    const env = {
        ...process.env,
        APPLE_SIGNING_IDENTITY: process.env.APPLE_SIGNING_IDENTITY || DEFAULT_SIGNING_IDENTITY,
        TAURI_SIGNING_PRIVATE_KEY: keyPath,
        TAURI_SIGNING_PRIVATE_KEY_PASSWORD: password,
    };
    console.log(`Building with signing identity "${env.APPLE_SIGNING_IDENTITY}" and the updater key at ${keyPath}.`);
    const result = spawnSync('bun', ['run', 'build:local'], { cwd: desktopDir, stdio: 'inherit', env });
    if (result.status !== 0) fail('desktop build failed.');
}

function sha256(path: string): string {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function readNotes(options: Options): string {
    if (options.notesFile) {
        if (!existsSync(options.notesFile)) fail(`notes file not found: ${options.notesFile}`);
        return readFileSync(options.notesFile, 'utf8');
    }
    return `Stride ${options.version}.\n\nSee https://github.com/${UPDATER_REPO}/releases/tag/v${options.version}`;
}

function shellQuote(value: string): string {
    return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

type Artifacts = {
    zip: string;
    updater: string;
    updaterSig: string;
    latestJson: string;
    sums: string;
    notes: string;
};

function collectArtifacts(options: Options, publicKey: string): Artifacts {
    const app = join(bundleDir, 'Stride.app');
    const tarball = join(bundleDir, 'Stride.app.tar.gz');
    const signature = `${tarball}.sig`;
    for (const path of [app, tarball, signature]) {
        if (!existsSync(path)) fail(`missing build output ${path}. Was TAURI_SIGNING_PRIVATE_KEY set for the build?`);
    }
    rmSync(options.outDir, { recursive: true, force: true });
    mkdirSync(options.outDir, { recursive: true });

    const updater = join(options.outDir, macUpdaterAssetName(options.version));
    const updaterSig = `${updater}.sig`;
    copyFileSync(tarball, updater);
    copyFileSync(signature, updaterSig);

    const zip = join(options.outDir, macInstallZipName(options.version));
    run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, zip]);

    const signatureText = readFileSync(updaterSig, 'utf8').trim();
    const verified = verifyUpdaterSignature({
        file: readFileSync(updater),
        signatureBase64: signatureText,
        publicKeyBase64: publicKey,
    });
    if (!verified) fail(`updater signature does not verify against the public key in tauri.conf.json (key ${minisignKeyId(publicKey)}).`);
    console.log(`Signature verified with public key ${minisignKeyId(publicKey)}.`);

    const notesText = readNotes(options);
    const notes = join(options.outDir, 'release-notes.md');
    writeFileSync(notes, `${notesText.trim()}\n`);

    const manifest = buildLatestJson({
        version: options.version,
        notes: notesText,
        pubDate: new Date(),
        artifacts: [{ target: MAC_UPDATER_TARGET, assetName: basename(updater), signature: signatureText }],
    });
    const errors = validateLatestJson(manifest);
    if (errors.length > 0) fail(`latest.json is invalid: ${errors.join(' ')}`);
    const latestJson = join(options.outDir, 'latest.json');
    writeFileSync(latestJson, `${JSON.stringify(manifest, null, 2)}\n`);

    const sums = join(options.outDir, 'SHA256SUMS.txt');
    writeFileSync(sums, [zip, updater, latestJson].map((path) => `${sha256(path)}  ${basename(path)}`).join('\n') + '\n');

    return { zip, updater, updaterSig, latestJson, sums, notes };
}

function ghReleaseArgs(options: Options, artifacts: Artifacts): string[] {
    return [
        'release', 'create', `v${options.version}`,
        '--repo', UPDATER_REPO,
        '--title', `Stride ${options.version}`,
        '--notes-file', artifacts.notes,
        artifacts.zip,
        artifacts.updater,
        artifacts.updaterSig,
        artifacts.latestJson,
        artifacts.sums,
    ];
}

function publish(options: Options, artifacts: Artifacts): void {
    const tag = `v${options.version}`;
    ensureCleanTree(options, 'before publish');
    if (run('git', ['tag', '--list', tag])) fail(`tag ${tag} already exists.`);
    run('git', ['fetch', PUBLIC_REMOTE, PUBLIC_BRANCH], { stdio: 'inherit' });
    const message = `Stride ${options.version}\n\n${readFileSync(artifacts.notes, 'utf8').trim()}\n`;
    const commit = run('git', ['commit-tree', 'HEAD^{tree}', '-p', `${PUBLIC_REMOTE}/${PUBLIC_BRANCH}`, '-F', '-'], { input: message });
    console.log(`Squashed public commit ${commit} on top of ${PUBLIC_REMOTE}/${PUBLIC_BRANCH}.`);
    run('git', ['push', PUBLIC_REMOTE, `${commit}:refs/heads/${PUBLIC_BRANCH}`], { stdio: 'inherit' });
    run('git', ['tag', '-a', tag, commit, '-m', `Stride ${options.version}`]);
    run('git', ['push', PUBLIC_REMOTE, tag], { stdio: 'inherit' });
    run('gh', ghReleaseArgs(options, artifacts), { stdio: 'inherit' });
    console.log(`Published ${tag}. Installed copies will see it at https://github.com/${UPDATER_REPO}/releases/latest/download/latest.json`);
}

function main(): void {
    const options = parseOptions(process.argv.slice(2));
    if (process.platform !== 'darwin') fail('release-mac must run on macOS.');
    ensureCleanTree(options, 'start');
    const keyPath = process.env.STRIDE_UPDATER_KEY_PATH || DEFAULT_KEY_PATH;
    if (!existsSync(keyPath)) fail(`updater private key not found at ${keyPath}. See docs/development/releasing.md.`);
    const publicKey = readPublicKey();

    setVersion(options.version);
    if (!options.skipBuild) build(keyPath);
    const artifacts = collectArtifacts(options, publicKey);

    console.log('\nRelease artifacts:');
    for (const path of [artifacts.zip, artifacts.updater, artifacts.updaterSig, artifacts.latestJson, artifacts.sums, artifacts.notes]) {
        console.log(`  ${path}`);
    }

    if (options.publish) {
        publish(options, artifacts);
        return;
    }
    console.log('\nDry run: nothing was pushed or published. To publish, commit the release, then rerun with --publish, which runs:');
    console.log(`  git fetch ${PUBLIC_REMOTE} ${PUBLIC_BRANCH}`);
    console.log(`  commit=$(git commit-tree 'HEAD^{tree}' -p ${PUBLIC_REMOTE}/${PUBLIC_BRANCH} -F <message>)`);
    console.log(`  git push ${PUBLIC_REMOTE} "$commit:refs/heads/${PUBLIC_BRANCH}"`);
    console.log(`  git tag -a v${options.version} "$commit" -m 'Stride ${options.version}' && git push ${PUBLIC_REMOTE} v${options.version}`);
    console.log(`  gh ${ghReleaseArgs(options, artifacts).map(shellQuote).join(' ')}`);
}

if (import.meta.main) main();
