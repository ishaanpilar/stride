import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { main, upsertChecksumLines } from './upsert-sha256sums';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);

describe('upsertChecksumLines', () => {
    test('appends new files and replaces lines for files already listed', () => {
        const existing = `${A}  Stride-1.6.0-macOS.zip\n${B}  latest.json\n`;
        expect(upsertChecksumLines(existing, [
            { name: 'latest.json', sha256: C },
            { name: 'Stride_1.6.0_x64-setup.exe', sha256: A },
        ])).toBe(`${A}  Stride-1.6.0-macOS.zip\n${C}  latest.json\n${A}  Stride_1.6.0_x64-setup.exe\n`);
    });

    test('is idempotent on re-runs and starts a file when none exists', () => {
        const once = upsertChecksumLines('', [{ name: 'x.msi', sha256: A }]);
        expect(upsertChecksumLines(once, [{ name: 'x.msi', sha256: A }])).toBe(once);
        expect(() => upsertChecksumLines('', [{ name: 'x', sha256: 'nope' }])).toThrow('Bad SHA-256');
    });

    test('hashes files from disk', () => {
        const dir = mkdtempSync(join(tmpdir(), 'stride-sums-'));
        const file = join(dir, 'Stride_1.6.0_x64_en-US.msi');
        const sums = join(dir, 'SHA256SUMS.txt');
        writeFileSync(file, 'abc');
        main([sums, file]);
        expect(readFileSync(sums, 'utf8')).toBe(
            'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  Stride_1.6.0_x64_en-US.msi\n',
        );
    });
});
