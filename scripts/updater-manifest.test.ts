import { describe, expect, test } from 'bun:test';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';

import {
    buildLatestJson,
    macUpdaterAssetName,
    minisignKeyId,
    releaseAssetUrl,
    validateLatestJson,
    verifyUpdaterSignature,
} from './updater-manifest';

const SIGNATURE = Buffer.from('untrusted comment: signature from tauri secret key\nRUQ...\n').toString('base64');

function makeMinisignFixture(file: Uint8Array) {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const rawPublic = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
    const keyId = Buffer.from('0123456789abcdef', 'hex');
    const publicKeyText = `untrusted comment: minisign public key: TEST\n${Buffer.concat([Buffer.from('Ed'), keyId, rawPublic]).toString('base64')}\n`;
    const digest = createHash('blake2b512').update(file).digest();
    const signature = sign(null, digest, privateKey);
    const trustedComment = 'timestamp:1700000000\tfile:Stride.app.tar.gz';
    const globalSignature = sign(null, Buffer.concat([signature, Buffer.from(trustedComment)]), privateKey);
    const signatureText = [
        'untrusted comment: signature from tauri secret key',
        Buffer.concat([Buffer.from('ED'), keyId, signature]).toString('base64'),
        `trusted comment: ${trustedComment}`,
        globalSignature.toString('base64'),
        '',
    ].join('\n');
    return {
        publicKeyBase64: Buffer.from(publicKeyText).toString('base64'),
        signatureBase64: Buffer.from(signatureText).toString('base64'),
    };
}

describe('buildLatestJson', () => {
    test('produces the Tauri v2 static manifest shape for Apple silicon', () => {
        const manifest = buildLatestJson({
            version: '1.5.0',
            notes: '  ## Fixes\n- Faster sync  ',
            pubDate: new Date('2026-11-05T10:11:12.345Z'),
            artifacts: [{ target: 'darwin-aarch64', assetName: macUpdaterAssetName('1.5.0'), signature: `${SIGNATURE}\n` }],
        });
        expect(manifest).toEqual({
            version: '1.5.0',
            notes: '## Fixes\n- Faster sync',
            pub_date: '2026-11-05T10:11:12Z',
            platforms: {
                'darwin-aarch64': {
                    signature: SIGNATURE,
                    url: 'https://github.com/ishaanpilar/stride/releases/download/v1.5.0/Stride_1.5.0_aarch64.app.tar.gz',
                },
            },
        });
        expect(validateLatestJson(manifest)).toEqual([]);
    });

    test('rejects bad versions, targets, duplicate targets and multi-line signatures', () => {
        const base = { notes: '', pubDate: new Date(), artifacts: [{ target: 'darwin-aarch64', assetName: 'a.tar.gz', signature: SIGNATURE }] };
        expect(() => buildLatestJson({ ...base, version: 'v1.5.0' })).toThrow('X.Y.Z');
        expect(() => buildLatestJson({ ...base, version: '1.5.0', artifacts: [] })).toThrow('At least one');
        expect(() => buildLatestJson({ ...base, version: '1.5.0', artifacts: [{ ...base.artifacts[0], target: 'macos' }] })).toThrow('Unknown');
        expect(() => buildLatestJson({ ...base, version: '1.5.0', artifacts: [base.artifacts[0], base.artifacts[0]] })).toThrow('Duplicate');
        expect(() => buildLatestJson({ ...base, version: '1.5.0', artifacts: [{ ...base.artifacts[0], signature: 'untrusted comment: x\nabc' }] })).toThrow('single-line');
    });

    test('url-encodes asset names', () => {
        expect(releaseAssetUrl('1.5.0', 'Stride 1.5.0.tar.gz')).toBe('https://github.com/ishaanpilar/stride/releases/download/v1.5.0/Stride%201.5.0.tar.gz');
    });

    test('validateLatestJson reports missing fields', () => {
        expect(validateLatestJson({ version: '1.5', platforms: {} })).toEqual([
            'version must be X.Y.Z.',
            'notes must be a string.',
            'pub_date must be an RFC 3339 timestamp.',
            'platforms must list at least one target.',
        ]);
        expect(validateLatestJson({
            version: '1.5.0', notes: '', pub_date: '2026-11-05T00:00:00Z',
            platforms: { 'darwin-aarch64': { signature: SIGNATURE, url: 'http://example.com/a' } },
        })).toEqual(['darwin-aarch64: url must be https.']);
    });
});

describe('verifyUpdaterSignature', () => {
    const file = new TextEncoder().encode('Stride.app.tar.gz payload');

    test('accepts a prehashed minisign signature made by the matching key', () => {
        const fixture = makeMinisignFixture(file);
        expect(verifyUpdaterSignature({ file, ...fixture })).toBe(true);
        expect(minisignKeyId(fixture.publicKeyBase64)).toBe('EFCDAB8967452301');
    });

    test('rejects a tampered file or a signature from another key', () => {
        const fixture = makeMinisignFixture(file);
        const other = makeMinisignFixture(file);
        expect(verifyUpdaterSignature({ file: new TextEncoder().encode('tampered'), ...fixture })).toBe(false);
        expect(verifyUpdaterSignature({
            file,
            signatureBase64: other.signatureBase64,
            publicKeyBase64: fixture.publicKeyBase64,
        })).toBe(false);
    });

    test('verifies against the public key shipped in tauri.conf.json format', () => {
        const fixture = makeMinisignFixture(file);
        expect(() => verifyUpdaterSignature({ file, signatureBase64: fixture.signatureBase64, publicKeyBase64: 'bm90IGEga2V5' })).toThrow('minisign');
    });
});
