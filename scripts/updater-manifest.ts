import { createHash, createPublicKey, verify } from 'node:crypto';

export const UPDATER_REPO = 'ishaanpilar/stride';
export const MAC_UPDATER_TARGET = 'darwin-aarch64';
export const WINDOWS_UPDATER_TARGET = 'windows-x86_64';

export type UpdaterPlatformEntry = {
    signature: string;
    url: string;
};

export type UpdaterManifest = {
    version: string;
    notes: string;
    pub_date: string;
    platforms: Record<string, UpdaterPlatformEntry>;
};

export type UpdaterArtifactInput = {
    target: string;
    assetName: string;
    signature: string;
};

export type BuildLatestJsonInput = {
    version: string;
    notes: string;
    pubDate: Date;
    artifacts: UpdaterArtifactInput[];
    repo?: string;
};

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const TARGET_PATTERN = /^(darwin|linux|windows)-(aarch64|x86_64|i686|armv7)$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

export const isReleaseVersion = (version: string): boolean => VERSION_PATTERN.test(version);

export function releaseAssetUrl(version: string, assetName: string, repo = UPDATER_REPO): string {
    return `https://github.com/${repo}/releases/download/v${version}/${encodeURIComponent(assetName)}`;
}

export function macUpdaterAssetName(version: string): string {
    return `Stride_${version}_aarch64.app.tar.gz`;
}

export function macInstallZipName(version: string): string {
    return `Stride-${version}-macOS.zip`;
}

/** NSIS installer: first installs and, signed, the Windows in-app update bundle. */
export function windowsSetupAssetName(version: string): string {
    return `Stride_${version}_x64-setup.exe`;
}

export function windowsMsiAssetName(version: string): string {
    return `Stride_${version}_x64_en-US.msi`;
}

export type AddUpdaterPlatformInput = {
    version: string;
    target: string;
    assetName: string;
    signature: string;
    repo?: string;
};

/**
 * Adds (or replaces) one platform in an existing latest.json, e.g. the Windows entry after the macOS
 * release created the manifest. The manifest must already describe `version`, so a Windows build of
 * one tag can never point the updater at another release.
 */
export function addUpdaterPlatform(manifest: unknown, input: AddUpdaterPlatformInput): UpdaterManifest {
    const errors = validateLatestJson(manifest);
    if (errors.length > 0) throw new Error(`Existing latest.json is invalid: ${errors.join(' ')}`);
    const current = manifest as UpdaterManifest;
    if (current.version !== input.version) {
        throw new Error(`latest.json is for ${current.version}, not ${input.version}; refusing to mix releases.`);
    }
    const [entry] = Object.values(buildLatestJson({
        version: input.version,
        notes: current.notes,
        pubDate: new Date(current.pub_date),
        artifacts: [{ target: input.target, assetName: input.assetName, signature: input.signature }],
        repo: input.repo,
    }).platforms);
    return {
        ...current,
        platforms: { ...current.platforms, [input.target]: entry },
    };
}

export function buildLatestJson({ version, notes, pubDate, artifacts, repo = UPDATER_REPO }: BuildLatestJsonInput): UpdaterManifest {
    if (!isReleaseVersion(version)) throw new Error(`Version must be X.Y.Z, got "${version}".`);
    if (Number.isNaN(pubDate.getTime())) throw new Error('pub_date is not a valid date.');
    if (artifacts.length === 0) throw new Error('At least one updater artifact is required.');
    const platforms: Record<string, UpdaterPlatformEntry> = {};
    for (const artifact of artifacts) {
        if (!TARGET_PATTERN.test(artifact.target)) throw new Error(`Unknown updater target "${artifact.target}".`);
        if (platforms[artifact.target]) throw new Error(`Duplicate updater target "${artifact.target}".`);
        const signature = artifact.signature.trim();
        if (!signature || !BASE64_PATTERN.test(signature)) {
            throw new Error(`Signature for ${artifact.target} must be the single-line base64 contents of the .sig file.`);
        }
        platforms[artifact.target] = {
            signature,
            url: releaseAssetUrl(version, artifact.assetName, repo),
        };
    }
    return {
        version,
        notes: notes.trim(),
        pub_date: pubDate.toISOString().replace(/\.\d{3}Z$/, 'Z'),
        platforms,
    };
}

export function validateLatestJson(value: unknown): string[] {
    const errors: string[] = [];
    if (!value || typeof value !== 'object') return ['latest.json must be an object.'];
    const manifest = value as Partial<UpdaterManifest>;
    if (typeof manifest.version !== 'string' || !isReleaseVersion(manifest.version)) errors.push('version must be X.Y.Z.');
    if (typeof manifest.notes !== 'string') errors.push('notes must be a string.');
    if (typeof manifest.pub_date !== 'string' || Number.isNaN(Date.parse(manifest.pub_date))) {
        errors.push('pub_date must be an RFC 3339 timestamp.');
    }
    const platforms = manifest.platforms;
    if (!platforms || typeof platforms !== 'object' || Object.keys(platforms).length === 0) {
        errors.push('platforms must list at least one target.');
        return errors;
    }
    for (const [target, entry] of Object.entries(platforms)) {
        if (!TARGET_PATTERN.test(target)) errors.push(`${target}: unknown target.`);
        if (!entry || typeof entry.signature !== 'string' || !BASE64_PATTERN.test(entry.signature)) {
            errors.push(`${target}: signature must be base64.`);
        }
        if (!entry || typeof entry.url !== 'string' || !entry.url.startsWith('https://')) {
            errors.push(`${target}: url must be https.`);
        }
    }
    return errors;
}

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

const decodeBase64Text = (value: string): string => Buffer.from(value.trim(), 'base64').toString('utf8');

const nonCommentLines = (text: string): string[] => text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

type MinisignPublicKey = { keyId: Buffer; key: Buffer };

function parseMinisignPublicKey(publicKeyBase64: string): MinisignPublicKey {
    const lines = nonCommentLines(decodeBase64Text(publicKeyBase64)).filter((line) => !line.startsWith('untrusted comment:'));
    const raw = Buffer.from(lines[0] ?? '', 'base64');
    if (raw.length !== 42 || raw.subarray(0, 2).toString('latin1') !== 'Ed') {
        throw new Error('Public key is not a minisign Ed25519 key.');
    }
    return { keyId: raw.subarray(2, 10), key: raw.subarray(10) };
}

type MinisignSignature = {
    algorithm: string;
    keyId: Buffer;
    signature: Buffer;
    trustedComment: string;
    globalSignature: Buffer;
};

function parseMinisignSignature(signatureBase64: string): MinisignSignature {
    const lines = nonCommentLines(decodeBase64Text(signatureBase64));
    const signatureLine = lines.find((line) => !line.includes(':'));
    const trustedLine = lines.find((line) => line.startsWith('trusted comment: '));
    const globalLine = trustedLine ? lines[lines.indexOf(trustedLine) + 1] : undefined;
    if (!signatureLine || !trustedLine || !globalLine) throw new Error('Signature is not a minisign signature file.');
    const raw = Buffer.from(signatureLine, 'base64');
    if (raw.length !== 74) throw new Error('Signature has an unexpected length.');
    return {
        algorithm: raw.subarray(0, 2).toString('latin1'),
        keyId: raw.subarray(2, 10),
        signature: raw.subarray(10),
        trustedComment: trustedLine.slice('trusted comment: '.length),
        globalSignature: Buffer.from(globalLine, 'base64'),
    };
}

export function verifyUpdaterSignature({
    file,
    signatureBase64,
    publicKeyBase64,
}: {
    file: Uint8Array;
    signatureBase64: string;
    publicKeyBase64: string;
}): boolean {
    const publicKey = parseMinisignPublicKey(publicKeyBase64);
    const parsed = parseMinisignSignature(signatureBase64);
    if (!parsed.keyId.equals(publicKey.keyId)) return false;
    const keyObject = createPublicKey({
        key: Buffer.concat([ED25519_SPKI_PREFIX, publicKey.key]),
        format: 'der',
        type: 'spki',
    });
    const message = parsed.algorithm === 'ED'
        ? createHash('blake2b512').update(file).digest()
        : Buffer.from(file);
    if (parsed.algorithm !== 'ED' && parsed.algorithm !== 'Ed') return false;
    if (!verify(null, message, keyObject, parsed.signature)) return false;
    const globalMessage = Buffer.concat([parsed.signature, Buffer.from(parsed.trustedComment, 'utf8')]);
    return verify(null, globalMessage, keyObject, parsed.globalSignature);
}

export function minisignKeyId(publicKeyBase64: string): string {
    return Buffer.from(parseMinisignPublicKey(publicKeyBase64).keyId).reverse().toString('hex').toUpperCase();
}
