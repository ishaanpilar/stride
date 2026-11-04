import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExpoConfig } from 'expo/config';
import appJson from '../app.json';

const loadConfig = async (): Promise<ExpoConfig> => {
  vi.resetModules();
  const mod = await import('../app.config');
  return mod.default({ config: appJson.expo as ExpoConfig, projectRoot: '', staticConfigPath: null, packageJsonPath: null });
};

const widgetLabels = (config: ExpoConfig): string[] => (config.plugins ?? [])
  .filter((entry): entry is [string, { label: string }] => Array.isArray(entry) && entry[0] === './plugins/android-widget')
  .map(([, props]) => props.label);

describe('app.config APP_VARIANT', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('leaves the store identity alone when no variant is set', async () => {
    vi.stubEnv('APP_VARIANT', '');
    const config = await loadConfig();
    expect(config.name).toBe('Stride');
    expect(config.ios?.infoPlist?.CFBundleSpokenName).toBe('Stride');
    expect(config.ios?.infoPlist?.CFBundleLocalizations).toEqual(appJson.expo.ios.infoPlist.CFBundleLocalizations);
    expect(config.ios?.infoPlist?.INAlternativeAppNames).toEqual([{
      INAlternativeAppName: 'Stride',
      INAlternativeAppNamePronunciationHint: 'stride',
    }]);
    expect(config.android?.package).toBe('com.ishaanpilar.stride');
    expect(config.ios?.bundleIdentifier).toBe('com.ishaanpilar.stride');
    expect(widgetLabels(config)).toEqual(['Stride']);
  });

  it('builds Stride Dev with its own ids so it installs beside the store app', async () => {
    vi.stubEnv('APP_VARIANT', 'development');
    const config = await loadConfig();
    expect(config.name).toBe('Stride Dev');
    expect(config.ios?.infoPlist?.CFBundleSpokenName).toBe('Stride Dev');
    expect(config.ios?.infoPlist?.INAlternativeAppNames).toEqual([{
      INAlternativeAppName: 'Stride Dev',
      INAlternativeAppNamePronunciationHint: 'stride dev',
    }]);
    expect(config.android?.package).toBe('com.ishaanpilar.stride.dev');
    expect(config.ios?.bundleIdentifier).toBe('com.ishaanpilar.stride.dev');
    expect(config.scheme).toBe('stride');
    expect(widgetLabels(config)).toEqual(['Stride Dev']);
  });

  it.each([
    ['benchmark', '', false],
    ['', '', false],
    ['development', '', true],
    ['development', 'false', false],
    ['', 'true', true],
    ['', '1', true],
    ['', '0', false],
  ])('gates Watch for variant=%s flag=%s', async (variant, flag, enabled) => {
    vi.stubEnv('APP_VARIANT', variant);
    vi.stubEnv('STRIDE_WATCH_ENABLED', flag);
    const config = await loadConfig();
    expect(config.extra?.watchEnabled).toBe(enabled);
    expect(config.ios?.infoPlist?.StrideWatchEnabled).toBe(enabled);
    expect(config.plugins).toContainEqual(['./plugins/ios-watch', { enabled }]);
  });

  it('isolates the Android benchmark identity and disables heartbeat traffic', async () => {
    vi.stubEnv('APP_VARIANT', 'benchmark');
    const config = await loadConfig();
    expect(config.name).toBe('Stride Benchmark');
    expect(config.android?.package).toBe('com.ishaanpilar.stride.benchmark');
    expect(config.scheme).toBe('stride-benchmark');

    const urlTypes = (config.ios?.infoPlist?.CFBundleURLTypes ?? []) as { CFBundleURLSchemes?: string[] }[];
    expect(urlTypes.find((type) => type.CFBundleURLSchemes)?.CFBundleURLSchemes).toContain('stride-benchmark');
    expect(config.platforms).toEqual(['android']);
    expect(config.extra?.analyticsHeartbeatUrl).toBe('');
    expect(widgetLabels(config)).toEqual(['Stride Benchmark']);
  });

  it.each([
    ['', '1'],
    ['benchmark', '1'],
    ['development', ''],
    ['development', '0'],
  ])('keeps PCC evaluation and its entitlement off for variant=%s flag=%s', async (variant, flag) => {
    vi.stubEnv('APP_VARIANT', variant);
    vi.stubEnv('STRIDE_PCC_EVALUATION_ENABLED', flag);
    const config = await loadConfig();
    expect(config.extra?.applePccEvaluationEnabled).toBe(false);
    expect(config.ios?.infoPlist?.StridePccEvaluationEnabled).toBe(false);
    expect(config.ios?.entitlements?.['com.apple.developer.private-cloud-compute']).toBeUndefined();
  });

  it('adds the managed PCC entitlement only to an explicitly opted-in development build', async () => {
    vi.stubEnv('APP_VARIANT', 'development');
    vi.stubEnv('STRIDE_PCC_EVALUATION_ENABLED', '1');
    const config = await loadConfig();
    expect(config.extra?.applePccEvaluationEnabled).toBe(true);
    expect(config.ios?.infoPlist?.StridePccEvaluationEnabled).toBe(true);
    expect(config.ios?.entitlements?.['com.apple.developer.private-cloud-compute']).toBe(true);
  });

  it('preserves unrelated iOS entitlements while stripping inherited PCC access when disabled', async () => {
    vi.stubEnv('APP_VARIANT', 'development');
    vi.stubEnv('STRIDE_PCC_EVALUATION_ENABLED', '0');
    vi.resetModules();
    const mod = await import('../app.config');
    const base = {
      ...(appJson.expo as ExpoConfig),
      ios: {
        ...(appJson.expo.ios as ExpoConfig['ios']),
        entitlements: {
          'com.apple.developer.associated-domains': ['applinks:example.invalid'],
          'com.apple.developer.private-cloud-compute': true,
        },
      },
    } as ExpoConfig;
    const config = mod.default({ config: base, projectRoot: '', staticConfigPath: null, packageJsonPath: null });
    expect(config.ios?.entitlements).toEqual({
      'com.apple.developer.associated-domains': ['applinks:example.invalid'],
    });
  });
});
