import { ExternalLink, MessageSquare, RefreshCw } from 'lucide-react';
import { getDocsGuideUrl } from '@stride/core';
import { useDocumentationLanguage } from '../../../contexts/language-context';

import { cn } from '../../../lib/utils';

type Labels = {
    version: string;
    installChannel: string;
    license: string;
    github: string;
    documentation: string;
    videoTutorials: string;
    privacy: string;
    terms: string;
    sponsorProject: string;
    checkForUpdates: string;
    checking: string;
    checkFailed: string;
    feedback: string;
    feedbackDesc: string;
    feedbackCategory: string;
    feedbackCategoryBug: string;
    feedbackCategoryFeature: string;
    feedbackCategoryOther: string;
    feedbackMessage: string;
    feedbackMessagePlaceholder: string;
    feedbackMessagePlaceholderBug: string;
    feedbackMessagePlaceholderFeature: string;
    feedbackMessagePlaceholderOther: string;
    feedbackWhere: string;
    feedbackWherePlaceholder: string;
    feedbackWhereMessagePrefix: string;
    feedbackWhereInbox: string;
    feedbackWhereFocus: string;
    feedbackWhereProjects: string;
    feedbackWhereReview: string;
    feedbackWhereSettings: string;
    feedbackWhereSync: string;
    feedbackWhereImportExport: string;
    feedbackWhereNotifications: string;
    feedbackWhereOther: string;
    feedbackEmail: string;
    feedbackEmailPlaceholder: string;
    feedbackNoEmailTitle: string;
    feedbackNoEmailDesc: string;
    feedbackAddEmail: string;
    feedbackSendWithoutEmail: string;
    feedbackIncludeDiagnostics: string;
    feedbackIncludeDiagnosticsDesc: string;
    feedbackPrivacy: string;
    feedbackSubmit: string;
    feedbackSending: string;
    feedbackSent: string;
    feedbackFailed: string;
    feedbackUnavailable: string;
    feedbackUnavailableDesc: string;
    feedbackOpenGitHubIssue: string;
    feedbackGitHubDesc: string;
    feedbackOpenGitHubDiscussion: string;
    feedbackRequired: string;
    feedbackInvalidEmail: string;
    close: string;
};

export type SettingsAboutPageProps = {
    t: Labels;
    appVersion: string;

    updatesSupported?: boolean;
    installChannel?: string | null;
    onOpenLink: (url: string) => void;
    onCheckUpdates: () => void;
    isCheckingUpdate: boolean;
    updateActionLabel?: string;
    updateError: string | null;
    updateNotice: string | null;
};

export function SettingsAboutPage({
    t,
    appVersion,
    updatesSupported = true,
    installChannel,
    onOpenLink,
    onCheckUpdates,
    isCheckingUpdate,
    updateActionLabel,
    updateError,
    updateNotice,
}: SettingsAboutPageProps) {
    const language = useDocumentationLanguage();
    const actionLabel = updateActionLabel ?? t.checkForUpdates;

    return (
        <>
            <div className="p-6 space-y-4 bg-well rounded-card">
                <div data-settings-key="version" className="flex justify-between items-center">
                    <span className="text-muted-foreground">{t.version}</span>
                    <span className="font-mono bg-muted px-2 py-1 rounded text-sm">v{appVersion}</span>
                </div>
                {installChannel && (
                    <>
                        <div className="border-t border-border/50"></div>
                        <div data-settings-key="installChannel" className="flex justify-between items-center gap-4">
                            <span className="text-muted-foreground">{t.installChannel}</span>
                            <span className="font-mono bg-muted px-2 py-1 rounded text-sm">{installChannel}</span>
                        </div>
                    </>
                )}
                {updatesSupported && (<>
                <div className="border-t border-border/50"></div>
                <div data-settings-key="checkForUpdates" className="flex justify-between items-center">
                    <span className="text-muted-foreground">{actionLabel}</span>
                    <button
                        onClick={onCheckUpdates}
                        disabled={isCheckingUpdate}
                        className={cn(
                            "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                            isCheckingUpdate
                                ? "bg-muted text-muted-foreground cursor-not-allowed"
                                : "btn-gradient focus-ring",
                        )}
                    >
                        <RefreshCw className={cn("w-4 h-4", isCheckingUpdate && "animate-spin")} />
                        {isCheckingUpdate ? t.checking : actionLabel}
                    </button>
                </div>
                </>)}
                {updateError && (
                    <div className="text-danger-text text-sm">{t.checkFailed}</div>
                )}
                {updateNotice && !updateError && (
                    <div className="text-sm text-muted-foreground">{updateNotice}</div>
                )}
                <div className="border-t border-border/50"></div>
                <div data-settings-key="feedback" className="flex justify-between items-center gap-4">
                    <span className="text-muted-foreground">{t.feedback}</span>
                    <button
                        onClick={() => onOpenLink('https://github.com/ishaanpilar/stride/issues')}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-control text-sm font-medium btn-gradient focus-ring transition-colors"
                    >
                        <MessageSquare className="w-4 h-4" />
                        {t.feedback}
                    </button>
                </div>
                <div className="border-t border-border/50"></div>
                <div data-settings-key="documentation" className="flex justify-between items-center">
                    <span className="text-muted-foreground">{t.documentation}</span>
                    <button
                        onClick={() => onOpenLink(getDocsGuideUrl('', language))}
                        className="text-accent-text hover:underline flex items-center gap-1"
                    >
                        github.com/ishaanpilar/stride/tree/main/docs
                        <ExternalLink className="w-3 h-3" />
                    </button>
                </div>
                <div className="border-t border-border/50"></div>
                <div data-settings-key="github" className="flex justify-between items-center">
                    <span className="text-muted-foreground">{t.github}</span>
                    <button
                        onClick={() => onOpenLink('https://github.com/ishaanpilar/stride')}
                        className="text-accent-text hover:underline flex items-center gap-1"
                    >
                        github.com/ishaanpilar/stride
                        <ExternalLink className="w-3 h-3" />
                    </button>
                </div>
                <div className="border-t border-border/50"></div>
                <div className="text-sm text-muted-foreground">Built by Ishaan Pilar</div>
                <div className="border-t border-border/50"></div>
                <div data-testid="about-tribute" className="space-y-1.5 text-sm text-muted-foreground">
                    <p>
                        Stride is built on the ideas of{' '}
                        <button
                            type="button"
                            onClick={() => onOpenLink('https://gettingthingsdone.com')}
                            className="text-accent-text hover:underline"
                        >
                            Getting Things Done
                        </button>
                        {' '}by David Allen, the method behind its capture, clarify, organise, review and engage flow.
                    </p>
                    <p className="italic">Mind like water.</p>
                    <p className="text-xs text-tertiary">Stride is an independent app, not affiliated with or endorsed by David Allen.</p>
                </div>
            </div>
        </>
    );
}
