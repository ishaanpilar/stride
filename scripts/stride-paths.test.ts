import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { resolveStrideDataPath, resolveStrideDbPath } from './stride-paths';

const originalPlatform = process.platform;
const originalEnv = {


    HOME: process.env.HOME,
    APPDATA: process.env.APPDATA,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    XDG_DATA_HOME: process.env.XDG_DATA_HOME,
    STRIDE_DATA: process.env.STRIDE_DATA,
    STRIDE_DB_PATH: process.env.STRIDE_DB_PATH,
    STRIDE_DB: process.env.STRIDE_DB,
};
const tempDirs: string[] = [];

const setPlatform = (platform: string) => {
    Object.defineProperty(process, 'platform', { value: platform, configurable: true });
};

const makeTempDir = () => {
    const dir = mkdtempSync(join(tmpdir(), 'stride-paths-'));
    tempDirs.push(dir);
    return dir;
};

const touch = (path: string) => {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, '');
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

const clearOverrides = () => {
    delete process.env.STRIDE_DATA;
    delete process.env.STRIDE_DB_PATH;
    delete process.env.STRIDE_DB;
};

describe('automation script database discovery', () => {
    test('prefers the data/ subfolder on Windows over a flat root an older version left behind', () => {
        process.env.HOME = makeTempDir();
        const appData = makeTempDir();
        const flatDb = join(appData, 'stride', 'stride.db');
        const splitDb = join(appData, 'stride', 'data', 'stride.db');
        touch(flatDb);
        touch(splitDb);

        setPlatform('win32');
        process.env.APPDATA = appData;
        clearOverrides();

        expect(resolveStrideDbPath()).toBe(splitDb);
    });

    test('still finds a flat Windows root written by 1.3.1 and earlier', () => {
        process.env.HOME = makeTempDir();
        const appData = makeTempDir();
        const flatDb = join(appData, 'stride', 'stride.db');
        touch(flatDb);

        setPlatform('win32');
        process.env.APPDATA = appData;
        clearOverrides();

        expect(resolveStrideDbPath()).toBe(flatDb);
    });

    test('keeps the flat root on Linux, where the app never uses a data/ subfolder', () => {
        process.env.HOME = makeTempDir();
        const dataHome = makeTempDir();
        const flatDb = join(dataHome, 'stride', 'stride.db');
        const splitDb = join(dataHome, 'stride', 'data', 'stride.db');
        touch(flatDb);
        touch(splitDb);

        setPlatform('linux');
        process.env.XDG_DATA_HOME = dataHome;
        process.env.XDG_CONFIG_HOME = join(dataHome, 'config');
        clearOverrides();

        expect(resolveStrideDbPath()).toBe(flatDb);
    });


    test('finds a Flatpak profile on Linux when the XDG roots are empty', () => {
        const home = makeTempDir();
        const xdgHome = makeTempDir();
        const flatpakDb = join(
            home, '.var', 'app', 'com.ishaanpilar.stride', 'data', 'stride', 'stride.db'
        );
        touch(flatpakDb);

        setPlatform('linux');
        process.env.HOME = home;
        process.env.XDG_DATA_HOME = join(xdgHome, 'share');
        process.env.XDG_CONFIG_HOME = join(xdgHome, 'config');
        clearOverrides();

        expect(resolveStrideDbPath()).toBe(flatpakDb);
    });
});

describe('automation script explicit paths', () => {
    test('follows a pinned flat path into the installed data/ layout', () => {
        const root = makeTempDir();
        const pinnedDb = join(root, 'stride.db');
        const movedDb = join(root, 'data', 'stride.db');
        const pinnedData = join(root, 'data.json');
        const movedData = join(root, 'data', 'data.json');
        touch(movedDb);
        touch(movedData);
        clearOverrides();
        const errorSpy = spyOn(console, 'error').mockImplementation(() => undefined);

        try {
            expect(resolveStrideDbPath(pinnedDb)).toBe(movedDb);
            expect(resolveStrideDataPath(pinnedData)).toBe(movedData);
            expect(errorSpy).toHaveBeenCalledWith(
                `[stride] Using ${movedDb} (nothing at the configured path: ${pinnedDb})`
            );
        } finally {
            errorSpy.mockRestore();
        }
    });

    test('follows a pinned data/ path back to a flat profile an older version still uses', () => {
        const root = makeTempDir();
        const flatDb = join(root, 'stride.db');
        touch(flatDb);
        clearOverrides();
        const errorSpy = spyOn(console, 'error').mockImplementation(() => undefined);

        try {
            expect(resolveStrideDbPath(join(root, 'data', 'stride.db'))).toBe(flatDb);
        } finally {
            errorSpy.mockRestore();
        }
    });

    test('still creates the profile at an explicit path when neither layout exists', () => {
        const root = makeTempDir();
        const pinnedDb = join(root, 'scratch', 'stride.db');
        const pinnedData = join(root, 'scratch', 'data.json');
        clearOverrides();


        expect(resolveStrideDbPath(pinnedDb)).toBe(pinnedDb);
        expect(resolveStrideDataPath(pinnedData)).toBe(pinnedData);
        expect(existsSync(join(root, 'scratch'))).toBe(false);
    });


    test('ignores a sibling folder that is not a Stride profile', () => {
        const root = makeTempDir();
        const unrelated = join(root, 'data.json');
        const contents = '{"someOtherTool":true}';
        writeFileSync(unrelated, contents);
        const pinned = join(root, 'data', 'data.json');
        clearOverrides();

        expect(resolveStrideDataPath(pinned)).toBe(pinned);
        expect(readFileSync(unrelated, 'utf8')).toBe(contents);
    });

    test('ignores an unrelated data/data.json when no database sits beside it', () => {
        const root = makeTempDir();
        const unrelated = join(root, 'data', 'data.json');
        const contents = '{"someOtherTool":true}';
        touch(unrelated);
        writeFileSync(unrelated, contents);
        const pinned = join(root, 'data.json');
        clearOverrides();

        expect(resolveStrideDataPath(pinned)).toBe(pinned);
        expect(readFileSync(unrelated, 'utf8')).toBe(contents);
    });

    test('honours STRIDE_DB_PATH and STRIDE_DATA the same way', () => {
        const root = makeTempDir();
        const movedDb = join(root, 'data', 'stride.db');
        const movedData = join(root, 'data', 'data.json');
        touch(movedDb);
        touch(movedData);
        clearOverrides();
        process.env.STRIDE_DB_PATH = join(root, 'stride.db');
        process.env.STRIDE_DATA = join(root, 'data.json');
        const errorSpy = spyOn(console, 'error').mockImplementation(() => undefined);

        try {
            expect(resolveStrideDbPath()).toBe(movedDb);
            expect(resolveStrideDataPath()).toBe(movedData);
        } finally {
            errorSpy.mockRestore();
        }
    });
});
