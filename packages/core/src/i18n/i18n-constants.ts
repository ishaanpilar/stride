import type { Language } from './i18n-types';
import { LOCALES } from './i18n-locales';

// LEGACY: pre-Stride-rename value, kept so existing stored user data stays readable.
export const LANGUAGE_STORAGE_KEY = 'mindwtr-language';
export const SUPPORTED_LANGUAGES: Language[] = ['en', ...Object.keys(LOCALES) as Language[]];

export const isSupportedLanguage = (value: string | null | undefined): value is Language =>
    Boolean(value && SUPPORTED_LANGUAGES.includes(value as Language));
