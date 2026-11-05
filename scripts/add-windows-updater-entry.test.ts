import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { main, parseOptions } from './add-windows-updater-entry';
import { buildLatestJson, macUpdaterAssetName } from './updater-manifest';

const SIGNATURE = Buffer.from('untrusted comment: signature from tauri secret key\nRUQ...\n').toString('base64');

describe('add-windows-updater-entry', () => {
    test('parses flags, strips a v prefix and defaults --out to the manifest', () => {
        expect(parseOptions(['--manifest', 'latest.json', '--version', 'v1.6.0', '--signature-file', 'a.sig'])).toMatchObject({
            manifest: 'latest.json',
            version: '1.6.0',
            signatureFile: 'a.sig',
            out: 'latest.json',
            verify: undefined,
        });
        expect(() => parseOptions(['--manifest', 'latest.json'])).toThrow('Usage');
        expect(() => parseOptions(['--manifest', 'm', '--version', '1.6.0-beta.1', '--signature-file', 's'])).toThrow('X.Y.Z');
    });

    test('rewrites latest.json with the Windows entry', () => {
        const dir = mkdtempSync(join(tmpdir(), 'stride-latest-json-'));
        const manifestPath = join(dir, 'latest.json');
        const signaturePath = join(dir, 'Stride_1.6.0_x64-setup.exe.sig');
        writeFileSync(manifestPath, JSON.stringify(buildLatestJson({
            version: '1.6.0',
            notes: 'notes',
            pubDate: new Date('2026-11-06T10:00:00Z'),
            artifacts: [{ target: 'darwin-aarch64', assetName: macUpdaterAssetName('1.6.0'), signature: SIGNATURE }],
        })));
        writeFileSync(signaturePath, `${SIGNATURE}\n`);
        main(['--manifest', manifestPath, '--version', '1.6.0', '--signature-file', signaturePath]);
        const written = JSON.parse(readFileSync(manifestPath, 'utf8'));
        expect(Object.keys(written.platforms).sort()).toEqual(['darwin-aarch64', 'windows-x86_64']);
        expect(written.platforms['windows-x86_64'].signature).toBe(SIGNATURE);
    });

    test('refuses an installer that is not signed by the key in tauri.conf.json', () => {
        const dir = mkdtempSync(join(tmpdir(), 'stride-latest-json-'));
        const manifestPath = join(dir, 'latest.json');
        const installer = join(dir, 'Stride_1.6.0_x64-setup.exe');
        const signaturePath = `${installer}.sig`;
        const original = JSON.stringify(buildLatestJson({
            version: '1.6.0',
            notes: 'notes',
            pubDate: new Date('2026-11-06T10:00:00Z'),
            artifacts: [{ target: 'darwin-aarch64', assetName: macUpdaterAssetName('1.6.0'), signature: SIGNATURE }],
        }));
        writeFileSync(manifestPath, original);
        writeFileSync(installer, 'not really an installer');
        writeFileSync(signaturePath, SIGNATURE);
        expect(() => main([
            '--manifest', manifestPath, '--version', '1.6.0', '--signature-file', signaturePath, '--verify', installer,
        ])).toThrow();
        expect(readFileSync(manifestPath, 'utf8')).toBe(original);
    });
});
