import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { resolveStrideDbPath } from './paths.js';

const originalPlatform = process.platform;
const originalEnv = {
  HOME: process.env.HOME,
  APPDATA: process.env.APPDATA,
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  XDG_DATA_HOME: process.env.XDG_DATA_HOME,
  STRIDE_DB_PATH: process.env.STRIDE_DB_PATH,
  STRIDE_DB: process.env.STRIDE_DB,
};
const tempDirs: string[] = [];

const setPlatform = (platform: string) => {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
};

afterEach(() => {
  setPlatform(originalPlatform);
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('mcp default database discovery', () => {
  if (process.platform !== 'linux') return;

  test('prefers the data/ subfolder on Windows over a flat root an older version left behind', () => {
    const appData = mkdtempSync(join(tmpdir(), 'stride-mcp-layout-'));
    tempDirs.push(appData);
    const flatDb = join(appData, 'stride', 'stride.db');
    const splitDb = join(appData, 'stride', 'data', 'stride.db');
    mkdirSync(join(splitDb, '..'), { recursive: true });
    writeFileSync(flatDb, '');
    writeFileSync(splitDb, '');

    setPlatform('win32');
    process.env.APPDATA = appData;
    delete process.env.STRIDE_DB_PATH;
    delete process.env.STRIDE_DB;

    expect(resolveStrideDbPath()).toBe(splitDb);
  });

  test('keeps the flat root on Linux, where the app never uses a data/ subfolder', () => {
    const dataHome = mkdtempSync(join(tmpdir(), 'stride-mcp-linux-layout-'));
    tempDirs.push(dataHome);
    const flatDb = join(dataHome, 'stride', 'stride.db');
    const splitDb = join(dataHome, 'stride', 'data', 'stride.db');
    mkdirSync(join(splitDb, '..'), { recursive: true });
    writeFileSync(flatDb, '');
    writeFileSync(splitDb, '');

    process.env.XDG_DATA_HOME = dataHome;
    delete process.env.STRIDE_DB_PATH;
    delete process.env.STRIDE_DB;

    expect(resolveStrideDbPath()).toBe(flatDb);
  });

  test('expands a leading ~ in an explicit database path', () => {
    process.env.HOME = '/home/tester';
    delete process.env.STRIDE_DB_PATH;
    delete process.env.STRIDE_DB;


    expect(resolveStrideDbPath('~/.local/share/stride/stride.db'))
      .toBe('/home/tester/.local/share/stride/stride.db');
    expect(resolveStrideDbPath('~\\stride.db')).toBe('/home/tester/stride.db');
    expect(resolveStrideDbPath('/tmp/~tilde/stride.db')).toBe('/tmp/~tilde/stride.db');
  });

  test('discovers the Flatpak database when XDG locations are empty', () => {
    const home = mkdtempSync(join(tmpdir(), 'stride-mcp-flatpak-'));
    tempDirs.push(home);
    const dbPath = join(
      home,
      '.var',
      'app',
      'com.ishaanpilar.stride',
      'data',
      'stride',
      'stride.db'
    );
    mkdirSync(join(dbPath, '..'), { recursive: true });
    writeFileSync(dbPath, '');

    process.env.HOME = home;
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.XDG_DATA_HOME;
    delete process.env.STRIDE_DB_PATH;
    delete process.env.STRIDE_DB;

    expect(resolveStrideDbPath()).toBe(dbPath);
  });

  test('discovers the Snap database through the current revision link', () => {
    const home = mkdtempSync(join(tmpdir(), 'stride-mcp-snap-'));
    tempDirs.push(home);

    const dbPath = join(home, 'snap', 'stride', 'current', '.local', 'share', 'stride', 'stride.db');
    mkdirSync(join(dbPath, '..'), { recursive: true });
    writeFileSync(dbPath, '');

    process.env.HOME = home;
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.XDG_DATA_HOME;
    delete process.env.STRIDE_DB_PATH;
    delete process.env.STRIDE_DB;

    expect(resolveStrideDbPath()).toBe(dbPath);
  });

  test('falls back to the legacy pre-rename data directory when no Stride data exists', () => {
    const home = mkdtempSync(join(tmpdir(), 'stride-mcp-legacy-'));
    tempDirs.push(home);

    // LEGACY: old app directory and database name from before the Stride rename.
    const legacyDb = join(home, '.local', 'share', 'mindwtr', 'mindwtr.db');
    mkdirSync(join(legacyDb, '..'), { recursive: true });
    writeFileSync(legacyDb, '');

    process.env.HOME = home;
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.XDG_DATA_HOME;
    delete process.env.STRIDE_DB_PATH;
    delete process.env.STRIDE_DB;

    expect(resolveStrideDbPath()).toBe(legacyDb);

    const strideDb = join(home, '.local', 'share', 'stride', 'stride.db');
    mkdirSync(join(strideDb, '..'), { recursive: true });
    writeFileSync(strideDb, '');
    expect(resolveStrideDbPath()).toBe(strideDb);
  });
});
