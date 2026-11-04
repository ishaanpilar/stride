

import {
    buildAndroidQuickCaptureLabels,
    buildAndroidTaskPeekLabels,
    buildShortcutsSnapshot,
    buildWidgetPayload,
    createWidgetPayloadProjection,
    resolveWidgetDayFirst,
    resolveWidgetLanguage,
    SHORTCUTS_SNAPSHOT_ITEM_CAP,
    SHORTCUTS_SNAPSHOT_PROJECT_CAP,
    SHORTCUTS_SNAPSHOT_VERSION,
    WIDGET_FOCUS_URI,
    WIDGET_PEEK_DESCRIPTION_MAX,
    WIDGET_PEEK_TOKEN_MAX,
    WIDGET_QUICK_CAPTURE_URI,
} from '@stride/core/widget-payload';

export type {
    AndroidQuickCaptureLabels,
    AndroidTaskPeekLabels,
    AndroidTasksWidgetPayload,
    ShortcutsSnapshot,
    ShortcutsSnapshotListKey,
    ShortcutsSnapshotProjectGroup,
    ShortcutsSnapshotTaskItem,
    TasksWidgetPayload,
    WidgetColor,
    WidgetDueTone,
    WidgetListPayload,
    WidgetPalette,
    WidgetPayloadBuildOptions,
    WidgetPayloadProjection,
    WidgetSavedFilterOption,
    WidgetSystemColorScheme,
    WidgetTaskItem,
    WidgetTaskSection,
} from '@stride/core/widget-payload';
export type { WidgetTaskList } from '@stride/core/widget-lists';
export {
    buildAndroidQuickCaptureLabels,
    buildAndroidTaskPeekLabels,
    buildShortcutsSnapshot,
    buildWidgetPayload,
    createWidgetPayloadProjection,
    resolveWidgetDayFirst,
    resolveWidgetLanguage,
    SHORTCUTS_SNAPSHOT_ITEM_CAP,
    SHORTCUTS_SNAPSHOT_PROJECT_CAP,
    SHORTCUTS_SNAPSHOT_VERSION,
    WIDGET_FOCUS_URI,
    WIDGET_PEEK_DESCRIPTION_MAX,
    WIDGET_PEEK_TOKEN_MAX,
    WIDGET_QUICK_CAPTURE_URI,
};

// LEGACY: pre-Stride-rename value, kept so existing stored user data stays readable.
export const WIDGET_DATA_KEY = 'mindwtr-data';
// LEGACY: pre-Stride-rename value, kept so existing stored user data stays readable.
export const WIDGET_LANGUAGE_KEY = 'mindwtr-language';
export const IOS_WIDGET_APP_GROUP = 'group.com.ishaanpilar.stride';
export const IOS_WIDGET_PAYLOAD_KEY = 'stride-ios-widget-payload';
export const IOS_WIDGET_PAYLOAD_KEY_SMALL = 'stride-ios-widget-payload-small';
export const IOS_WIDGET_PAYLOAD_KEY_MEDIUM = 'stride-ios-widget-payload-medium';
export const IOS_WIDGET_PAYLOAD_KEY_LARGE = 'stride-ios-widget-payload-large';
export const IOS_WIDGET_PAYLOAD_KEY_EXTRA_LARGE = 'stride-ios-widget-payload-extra-large';


export const IOS_SHORTCUTS_SNAPSHOT_KEY = 'stride-ios-shortcuts-snapshot';
export const IOS_WIDGET_KIND = 'StrideTasksWidget';
export const IOS_WIDGET_COMPACT_KIND = 'StrideCompactWidget';
export const IOS_WIDGET_LOCK_KIND = 'StrideFocusLockWidget';
