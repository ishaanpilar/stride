
type DocsLocale = 'en' | 'de' | 'es' | 'fr' | 'zh-Hans' | 'zh-Hant';

export type DocsSection =
    | 'sync-encryption'
    | 'basic-workflow'
    | 'desktop-inbox'
    | 'desktop-focus'
    | 'desktop-scheduling'
    | 'desktop-details'
    | 'mobile-inbox'
    | 'mobile-focus'
    | 'mobile-scheduling'
    | 'mobile-details';


// Stride has no hosted docs site; all guide links point at the docs folder on GitHub.
const DOCS_BASE_URL = 'https://github.com/ishaanpilar/stride/tree/main/docs';

export function getDocsLocale(language: string | undefined): DocsLocale {
    if (language === 'zh') return 'zh-Hans';
    if (language === 'de' || language === 'es' || language === 'fr'
        || language === 'zh-Hans' || language === 'zh-Hant') return language;
    return 'en';
}


export function getDocsGuideUrl(_path: string, _language?: string, _section?: DocsSection): string {
    return DOCS_BASE_URL;
}
