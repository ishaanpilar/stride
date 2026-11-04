import { existsSync } from 'fs';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';

const APP_ID = 'com.ishaanpilar.stride';
const APP_DIR = 'stride';
const DB_FILE_NAME = 'stride.db';
const DATA_FILE_NAME = 'data.json';

// LEGACY_*: locations used before the app was renamed to Stride (formerly
// Mindwtr, then DoNext). Searched only after every Stride location so existing
// data is still found until the desktop app migrates it.
const LEGACY_APP_IDS = ['tech.dongdongbh.mindwtr', 'com.ishaanpilar.donext'];
const LEGACY_APP_DIRS = ['mindwtr', 'donext'];
const LEGACY_DB_FILE_NAMES = ['mindwtr.db', 'donext.db'];

function getHomeDir() {
  return process.env.HOME || homedir();
}

function getLinuxConfigHome() {
  return process.env.XDG_CONFIG_HOME || join(getHomeDir(), '.config');
}

function getLinuxDataHome() {
  return process.env.XDG_DATA_HOME || join(getHomeDir(), '.local', 'share');
}

function getWindowsAppDataHome() {
  return process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
}

function getMacAppSupportHome() {
  return join(homedir(), 'Library', 'Application Support');
}

function getMacSandboxAppSupportHome(APP_ID: string) {
  return join(homedir(), 'Library', 'Containers', APP_ID, 'Data', 'Library', 'Application Support');
}

function getConfigHome(): string {
  const platform = process.platform;
  if (platform === 'win32') return getWindowsAppDataHome();
  if (platform === 'darwin') return getMacAppSupportHome();
  return getLinuxConfigHome();
}

function getDataHome(): string {
  const platform = process.platform;
  if (platform === 'win32') return getWindowsAppDataHome();
  if (platform === 'darwin') return getMacAppSupportHome();
  return getLinuxDataHome();
}

function firstExisting(paths: string[]): string | null {
  for (const candidate of paths) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}


function expandHome(value: string): string {
  if (value === '~') return getHomeDir();
  if (value.startsWith('~/') || value.startsWith('~\\')) return join(getHomeDir(), value.slice(2));
  return value;
}

function getExplicitDbPath(overridePath?: string): string | null {
  const explicit = overridePath || process.env.STRIDE_DB_PATH || process.env.STRIDE_DB;
  return explicit ? resolve(expandHome(explicit)) : null;
}

function dedupe(paths: Array<string | null | undefined>): string[] {
  return Array.from(new Set(paths.filter((value): value is string => typeof value === 'string' && value.length > 0)));
}


function getProfileDirsFor(appDirs: string[], appIds: string[], snapName: string): string[] {
  const configHome = getConfigHome();
  const dataHome = getDataHome();
  const dirs: string[] = [];
  for (const APP_DIR of appDirs) {
    for (const APP_ID of appIds) {
      dirs.push(...getProfileDirsForPair(APP_DIR, APP_ID, configHome, dataHome, snapName));
    }
  }
  return dirs;
}

function getProfileDirsForPair(
  APP_DIR: string,
  APP_ID: string,
  configHome: string,
  dataHome: string,
  snapName: string,
): string[] {
  const dirs = [


    ...(process.platform === 'win32' || process.platform === 'darwin'
      ? [join(dataHome, APP_DIR, 'data')]
      : []),
    join(dataHome, APP_DIR),
    join(configHome, APP_DIR),
    join(dataHome, APP_ID),
    join(configHome, APP_ID),
  ];

  if (process.platform === 'linux') {
    const flatpakHome = join(getHomeDir(), '.var', 'app', APP_ID);
    dirs.push(join(flatpakHome, 'data', APP_DIR));
    dirs.push(join(flatpakHome, 'config', APP_DIR));

    dirs.push(join(getHomeDir(), 'snap', snapName, 'current', '.local', 'share', APP_DIR));
  }

  if (process.platform === 'darwin') {
    const sandboxHome = getMacSandboxAppSupportHome(APP_ID);
    dirs.push(join(sandboxHome, APP_DIR, 'data'));
    dirs.push(join(sandboxHome, APP_DIR));
    dirs.push(join(sandboxHome, APP_ID));
  }

  return dirs;
}

export function getDesktopProfileDirs(): string[] {
  return dedupe([
    ...getProfileDirsFor([APP_DIR], [APP_ID], 'stride'),
    ...LEGACY_APP_DIRS.flatMap((dir) => getProfileDirsFor([dir], LEGACY_APP_IDS, dir)),
  ]);
}

export function resolveStrideDataJsonPath(overridePath?: string): string {
  const explicitDbPath = getExplicitDbPath(overridePath);
  if (explicitDbPath) {
    return join(dirname(explicitDbPath), DATA_FILE_NAME);
  }
  const candidates = dedupe([
    ...getDesktopProfileDirs().map((dir) => join(dir, DATA_FILE_NAME)),
  ]);

  return firstExisting(candidates) || candidates[0];
}

export function resolveStrideDbPath(overridePath?: string): string {
  const explicitDbPath = getExplicitDbPath(overridePath);
  if (explicitDbPath) return explicitDbPath;
  const candidates = dedupe(
    getDesktopProfileDirs().flatMap((dir) => [
      join(dir, DB_FILE_NAME),
      ...LEGACY_DB_FILE_NAMES.map((name) => join(dir, name)),
    ]),
  );

  return firstExisting(candidates) || candidates[0];
}
