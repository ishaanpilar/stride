import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExpoConfig } from 'expo/config';
import appJson from '../app.json';

const CLIENT = '1234567890-designated.apps.googleusercontent.com';
const SCHEME = 'com.googleusercontent.apps.1234567890-designated';
const load = async (base = appJson.expo as ExpoConfig) => {
  vi.resetModules();
  const { default: configure } = await import('../app.config');
  return configure({ config: base, projectRoot: '', staticConfigPath: null, packageJsonPath: null });
};
const androidGate = (config: ExpoConfig) => config.plugins?.find(
  (entry) => Array.isArray(entry) && entry[0] === './plugins/android-gmail-authorization',
);

describe('Gmail native build gates', () => {
  beforeEach(() => {
    for (const name of ['APP_VARIANT', 'FOSS_BUILD', 'STRIDE_GMAIL_DEV_ENABLED', 'STRIDE_GMAIL_PRODUCTION_VERIFIED', 'STRIDE_GMAIL_IOS_CLIENT_ID']) {
      vi.stubEnv(name, '');
    }
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ['', '', '', false], ['', '1', '', false], ['', '', '1', true],
    ['development', '', '1', false], ['development', '1', '', true],
    ['benchmark', '1', '1', false],
  ])('gates variant=%s dev=%s verified=%s', async (variant, dev, verified, enabled) => {
    vi.stubEnv('APP_VARIANT', variant);
    vi.stubEnv('STRIDE_GMAIL_DEV_ENABLED', dev);
    vi.stubEnv('STRIDE_GMAIL_PRODUCTION_VERIFIED', verified);
    vi.stubEnv('STRIDE_GMAIL_IOS_CLIENT_ID', CLIENT);
    const config = await load();
    expect(androidGate(config)).toEqual(['./plugins/android-gmail-authorization', { enabled }]);
    expect(config.ios?.infoPlist?.StrideGmailEnabled).toBe(enabled);
    if (enabled) {
      expect(config.ios?.infoPlist?.StrideGmailClientId).toBe(CLIENT);
      expect(config.ios?.infoPlist?.CFBundleURLTypes).toEqual([{ CFBundleURLSchemes: ['stride', SCHEME] }]);
    } else {
      expect(config.ios?.infoPlist?.StrideGmailClientId).toBeUndefined();
    }
  });

  it('keeps FOSS unavailable even with every opt-in set', async () => {
    vi.stubEnv('APP_VARIANT', 'development');
    vi.stubEnv('FOSS_BUILD', '1');
    vi.stubEnv('STRIDE_GMAIL_DEV_ENABLED', '1');
    vi.stubEnv('STRIDE_GMAIL_PRODUCTION_VERIFIED', '1');
    vi.stubEnv('STRIDE_GMAIL_IOS_CLIENT_ID', CLIENT);
    const config = await load();
    expect(androidGate(config)).toEqual(['./plugins/android-gmail-authorization', { enabled: false }]);
    expect(config.ios?.infoPlist?.StrideGmailEnabled).toBe(false);
  });

  it.each(['', 'desktop-secret', 'not-a-client', 'https://evil.test/client.apps.googleusercontent.com'])(
    'requires a valid public iOS client ID: %s', async (client) => {
      vi.stubEnv('APP_VARIANT', 'development');
      vi.stubEnv('STRIDE_GMAIL_DEV_ENABLED', '1');
      vi.stubEnv('STRIDE_GMAIL_IOS_CLIENT_ID', client);
      const config = await load();
      expect(config.ios?.infoPlist?.StrideGmailEnabled).toBe(false);
      expect(config.ios?.infoPlist?.StrideGmailClientId).toBeUndefined();
      expect(androidGate(config)).toEqual(['./plugins/android-gmail-authorization', { enabled: true }]);
    },
  );

  it('strips inherited Gmail opt-ins and its old callback while preserving unrelated schemes', async () => {
    const config = await load({
      ...appJson.expo,
      ios: { ...appJson.expo.ios, infoPlist: {
        StrideGmailEnabled: true,
        StrideGmailClientId: CLIENT,
        CFBundleURLTypes: [{ CFBundleURLSchemes: ['stride', SCHEME] }],
      } },
    } as ExpoConfig);
    expect(config.ios?.infoPlist?.StrideGmailEnabled).toBe(false);
    expect(config.ios?.infoPlist?.StrideGmailClientId).toBeUndefined();
    expect(config.ios?.infoPlist?.CFBundleURLTypes).toEqual([{ CFBundleURLSchemes: ['stride'] }]);
  });

  it('keeps the app scheme first for expo-share-intent when adding the Gmail callback', async () => {
    vi.stubEnv('APP_VARIANT', 'development');
    vi.stubEnv('STRIDE_GMAIL_DEV_ENABLED', '1');
    vi.stubEnv('STRIDE_GMAIL_IOS_CLIENT_ID', CLIENT);
    const config = await load({ ...appJson.expo, ios: { ...appJson.expo.ios, infoPlist: {
      CFBundleURLTypes: [{ CFBundleURLName: 'existing', CFBundleURLSchemes: ['other-scheme'] }],
    } } } as ExpoConfig);
    const first = (config.ios?.infoPlist?.CFBundleURLTypes as { CFBundleURLSchemes: string[] }[])[0];
    expect(first.CFBundleURLSchemes).toEqual(['stride', 'other-scheme', SCHEME]);
  });
});
