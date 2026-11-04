


// LEGACY: pre-Stride-rename value, kept so existing stored user data stays readable.
export const SYNC_PATH_KEY = '@mindwtr_sync_path';
// LEGACY: pre-Stride-rename value, kept so existing stored user data stays readable.
export const SYNC_PATH_BOOKMARK_KEY = '@mindwtr_sync_path_bookmark';
// LEGACY: pre-Stride-rename value, kept so existing stored user data stays readable.
export const SYNC_BACKEND_KEY = '@mindwtr_sync_backend';
// LEGACY: pre-Stride-rename value, kept so existing stored user data stays readable.
export const WEBDAV_URL_KEY = '@mindwtr_webdav_url';
// LEGACY: pre-Stride-rename value, kept so existing stored user data stays readable.
export const WEBDAV_USERNAME_KEY = '@mindwtr_webdav_username';
// LEGACY: pre-Stride-rename value, kept so existing stored user data stays readable.
export const WEBDAV_PASSWORD_KEY = '@mindwtr_webdav_password';
// LEGACY: pre-Stride-rename value, kept so existing stored user data stays readable.
export const WEBDAV_ALLOW_INSECURE_HTTP_KEY = '@mindwtr_webdav_allow_insecure_http';
// LEGACY: pre-Stride-rename value, kept so existing stored user data stays readable.
export const WEBDAV_ALLOW_WEAK_FINGERPRINT_KEY = '@mindwtr_webdav_allow_weak_fingerprint';
// LEGACY: pre-Stride-rename value, kept so existing stored user data stays readable.
export const CLOUD_URL_KEY = '@mindwtr_cloud_url';
// LEGACY: pre-Stride-rename value, kept so existing stored user data stays readable.
export const CLOUD_TOKEN_KEY = '@mindwtr_cloud_token';
// LEGACY: pre-Stride-rename value, kept so existing stored user data stays readable.
export const CLOUD_PROVIDER_KEY = '@mindwtr_cloud_provider';
export const CLOUD_PROVIDER_DROPBOX = 'dropbox' as const;
// LEGACY: pre-Stride-rename value, kept so existing stored user data stays readable.
export const CLOUD_ALLOW_INSECURE_HTTP_KEY = '@mindwtr_cloud_allow_insecure_http';
// LEGACY: pre-Stride-rename value, kept so existing stored user data stays readable.
export const DROPBOX_LAST_REV_KEY = '@mindwtr_dropbox_last_rev';
// LEGACY: pre-Stride-rename value, kept so existing stored user data stays readable.
export const FAST_SYNC_STATE_KEY = '@mindwtr_fast_sync_state_v1';
// LEGACY: pre-Stride-rename value, kept so existing stored user data stays readable.
export const ATTACHMENT_PRESENCE_RECONCILE_KEY = '@mindwtr_attachment_presence_reconcile_v1';


// LEGACY: pre-Stride-rename value, kept so existing stored user data stays readable.
export const SYNC_ENCRYPTION_STATE_KEY = '@mindwtr_sync_encryption_state_v1';


// LEGACY: pre-Stride-rename value, kept so existing stored user data stays readable.
export const SYNC_ENCRYPTION_KEY_KEY = '@mindwtr_sync_encryption_key_v1';
// LEGACY: pre-Stride-rename value, kept so existing stored user data stays readable.
export const CLOUDKIT_CHANGE_TOKEN_KEY = '@mindwtr_cloudkit_change_token';
// LEGACY: pre-Stride-rename value, kept so existing stored user data stays readable.
export const CLOUDKIT_SEEDED_KEY = '@mindwtr_cloudkit_seeded';
// LEGACY: pre-Stride-rename value, kept so existing stored user data stays readable.
export const CLOUDKIT_ZONE_CREATED_KEY = '@mindwtr_cloudkit_zone_created';


// LEGACY: pre-Stride-rename value, kept so existing stored user data stays readable.
export const BACKGROUND_SYNC_LAST_REGISTERED_INTERVAL_KEY = '@mindwtr_background_sync_last_registered_interval';


// LEGACY: pre-Stride-rename value, kept so existing stored user data stays readable.
export const BACKGROUND_SYNC_FAILURE_STATE_KEY = '@mindwtr_background_sync_failure_state_v1';

export type LegacyBackgroundSyncInterval = 'off' | '15m' | '1h' | '6h';


export type SyncKeyValueStoragePort = {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    removeItem(key: string): Promise<void>;
};
