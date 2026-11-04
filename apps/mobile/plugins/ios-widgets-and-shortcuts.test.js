import { describe, expect, it } from 'vitest';

const fs = require('fs');
const os = require('os');
const path = require('path');
const plugin = require('./ios-widgets-and-shortcuts');

const {
  APP_INTENTS_FOLDER,
  IOS_WIDGET_MODULE_FOLDER,
  SHARED_WIDGET_ACTION_STORE,
  SIRI_CAPTURE_SHORTCUTS_PROVIDER,
  SPOTLIGHT_INDEXER,
  addSiriShortcutsRegistrationToAppDelegate,
  collectSwiftFiles,
  copySharedWidgetActionStore,
  ensureSourceFileInTarget,
  ensureWidgetSwiftSourcesInTarget,
} = plugin.__testables;

describe('ios-widgets-and-shortcuts', () => {
  it('keeps repeated prebuilds and new Swift files in the widget target with group-relative paths', () => {
    const project = require('xcode').project('fixture.pbxproj');
    project.hash = { project: { objects: {
      PBXNativeTarget: {
        APP: { buildPhases: [] },
        WIDGET: { buildPhases: [] },
      },
      PBXBuildFile: {}, PBXFileReference: {}, PBXGroup: {},
    } } };
    project.addBuildPhase([], 'PBXSourcesBuildPhase', 'Sources', 'APP');

    project.addBuildPhase(['Existing.swift'], 'PBXSourcesBuildPhase', 'StrideWidgets', 'WIDGET');
    const group = project.addPbxGroup(['Existing.swift'], 'StrideWidgets', 'StrideWidgets');
    const options = {
      swiftFiles: ['Existing.swift', 'New.swift'], groupKey: group.uuid, targetUuid: 'WIDGET',
    };

    expect(ensureWidgetSwiftSourcesInTarget(project, options)).toEqual(['New.swift']);
    expect(ensureWidgetSwiftSourcesInTarget(project, options)).toEqual([]);
    expect(project.pbxSourcesBuildPhaseObj('APP').files).toHaveLength(0);
    expect(project.pbxSourcesBuildPhaseObj('WIDGET').files).toHaveLength(2);
    const references = Object.values(project.pbxFileReferenceSection()).filter((entry) => typeof entry === 'object');
    expect(references.map((entry) => entry.path.replaceAll('"', ''))).toEqual(['Existing.swift', 'New.swift']);
  });

  it('ships saved-list Shortcuts with the existing widget catalog and preserves Open List', () => {
    const dir = path.resolve(__dirname, '..', APP_INTENTS_FOLDER);
    expect(collectSwiftFiles(dir)).toContain('StrideSavedListCatalog.swift');
    const source = fs.readFileSync(path.join(dir, 'StrideSiriCaptureIntents.swift'), 'utf8');
    expect(source).toContain('struct StrideOpenSavedListIntent: AppIntent');
    expect(source).toContain('var list: StrideSavedListEntity');
    expect(source).toContain('var list: StrideShortcutList');
    expect(source).toContain('StrideSavedListCatalog.destination(id: list.id)');
  });

  it('ships the rich configurable Tasks widget with legacy payload and iOS 15 fallbacks', () => {
    const widgetsDir = path.resolve(__dirname, '..', 'widgets-ios');
    const tasksSource = fs.readFileSync(
      path.join(widgetsDir, 'StrideTasksWidget.swift'),
      'utf8'
    );
    const intentsSource = fs.readFileSync(
      path.join(widgetsDir, 'StrideTasksWidgetIntents.swift'),
      'utf8'
    );
    const actionStoreSource = fs.readFileSync(
      path.resolve(__dirname, '..', IOS_WIDGET_MODULE_FOLDER, SHARED_WIDGET_ACTION_STORE),
      'utf8'
    );

    expect(tasksSource).toContain('let sections: [StrideWidgetSection]?');
    expect(tasksSource).toContain('let lists: [String: StrideWidgetListPayload]?');
    expect(tasksSource).toContain('let listTitles: [String: String]?');
    expect(tasksSource).toContain('let completeLabel: String?');
    expect(tasksSource).toContain('nonEmpty(completeLabel) ?? "Complete"');
    expect(tasksSource).toContain('pendingAction: pendingAction(for: item)');
    expect(tasksSource).toContain('.strikethrough(pendingAction != nil)');
    expect(tasksSource).toContain('item.openUri ?? payload.focusUri');
    expect(tasksSource).toContain('widgetFamily != .systemSmall');
    expect(tasksSource).toContain('StaticConfiguration(kind: kind');
    expect(tasksSource).toContain('if #available(iOSApplicationExtension 17.0, iOS 17.0, *)');
    expect(tasksSource).toContain('AppIntentConfiguration(');
    expect(tasksSource).toContain('StrideWidgetActionProjection.resolvedListId(');
    expect(tasksSource).toContain('StrideWidgetActionProjection.timelineDates(');
    expect(actionStoreSource).toContain('action.taskId == identity.taskId');
    expect(actionStoreSource).toContain('action.token == token');
    expect(actionStoreSource).toContain('now < action.notBefore');
    expect(tasksSource).not.toContain('familyTaskCap');
    expect(tasksSource).not.toContain('.claimReady(');
    expect(tasksSource).not.toContain('.acknowledge(');

    expect(intentsSource).toContain('struct StrideTasksWidgetConfigurationIntent: WidgetConfigurationIntent');
    expect(intentsSource).toContain('struct StrideTasksWidgetAppIntentProvider: AppIntentTimelineProvider');
    for (const listId of ['focus', 'inbox', 'next', 'upcoming', 'waiting', 'someday']) {
      expect(intentsSource).toContain(`"${listId}"`);
    }
    expect(intentsSource).toContain('payload.savedFilters ?? []');
    expect(intentsSource).toContain('StrideTasksWidgetSnapshotStore.contains(');
    expect(intentsSource).toContain('guard try store.cancel(id: actionId) else {');
    expect(intentsSource).not.toContain('store.pendingActions().contains');
  });

  it('keeps read-only Upcoming membership in the app-published snapshot', () => {
    const widgetsDir = path.resolve(__dirname, '..', 'widgets-ios');
    const tasksSource = fs.readFileSync(path.join(widgetsDir, 'StrideTasksWidget.swift'), 'utf8');
    const itemSource = fs.readFileSync(path.resolve(__dirname, '..', IOS_WIDGET_MODULE_FOLDER, 'StrideWidgetTaskItem.swift'), 'utf8');
    expect(itemSource).toContain('let upcomingDate: String?');
    expect(itemSource).toContain('let upcomingLabel: String?');
    expect(tasksSource).toContain('upcomingOnly: resolvedId == "upcoming"');
    expect(tasksSource).not.toContain('StrideWidgetUpcomingProjection.isVisible(');
    expect(tasksSource).not.toContain('StrideWidgetUpcomingProjection.timelineDates(');
    expect(tasksSource).toContain('if !item.isUpcomingPreview {\n                StrideWidgetTaskAction(');
    expect(tasksSource).toContain('Button(intent: StrideOpenWidgetTaskIntent(taskId: item.id))');
    expect(tasksSource).toContain('item.relabeled(days: upcomingDays, now: date)');
    expect(tasksSource).toContain('calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: now))');
    expect(tasksSource).toContain('!item.isUpcomingPreview && item.id == taskId');
    expect(tasksSource).toContain('completionToken: isUpcomingPreview ? nil : completionToken');
    expect(tasksSource).toContain('let payload = entry.payload');
  });

  it('pairs the small Upcoming task foreground action with the app task launcher', () => {
    const mobileRoot = path.resolve(__dirname, '..');
    const app = fs.readFileSync(path.join(mobileRoot, APP_INTENTS_FOLDER, 'StrideSiriCaptureIntents.swift'), 'utf8');
    const widget = fs.readFileSync(path.join(mobileRoot, 'widgets-ios', 'StrideTasksWidgetIntents.swift'), 'utf8');
    for (const source of [app, widget]) {
      const start = source.indexOf('struct StrideOpenWidgetTaskIntent: AppIntent');
      const intent = source.slice(start, source.indexOf('\n}\n', start));
      expect(start).toBeGreaterThan(0);
      expect(intent).toContain('"Open Task"');
      expect(intent).toContain('.foreground(.immediate)');
      expect(intent).toContain('static var openAppWhenRun: Bool { true }');
      expect(intent).toContain('var taskId: String');
      expect(intent).not.toContain('OpenURLIntent(');
    }
    const start = app.indexOf('struct StrideOpenWidgetTaskIntent: AppIntent');
    const action = app.slice(start, app.indexOf('\n}\n', start));
    expect(action).toContain('taskId.utf16.count <= 1_024');
    expect(action).toContain('CharacterSet.controlCharacters');
    expect(action).toContain('StrideSiriCaptureLauncher.taskURL(taskId: taskId)');
    expect(action).toContain('StrideSiriCaptureLauncher.open(url)');
  });

  it('selects one Tasks configuration at launch while preserving the installed widget kind', () => {
    const widgetsDir = path.resolve(__dirname, '..', 'widgets-ios');
    const tasksSource = fs.readFileSync(path.join(widgetsDir, 'StrideTasksWidget.swift'), 'utf8');
    const bundleSource = fs.readFileSync(path.join(widgetsDir, 'StrideWidgetsBundle.swift'), 'utf8');
    const configurations = tasksSource.slice(tasksSource.indexOf('struct StrideTasksWidget: Widget'));
    const [modern, legacy] = configurations.split('struct StrideLegacyTasksWidget: Widget');
    expect(modern).toContain('AppIntentConfiguration(');
    expect(modern).not.toContain('StaticConfiguration(');
    expect(legacy).toContain('StaticConfiguration(');
    for (const configuration of [modern, legacy]) {
      expect(configuration).toContain('let kind: String = strideWidgetKind');
      expect(configuration).toContain('.contentMarginsDisabled()');
      expect(configuration).not.toContain('if #available');
    }
    expect(bundleSource).toContain('enum StrideWidgetsEntryPoint');
    expect(bundleSource).toMatch(/if #available\(iOSApplicationExtension 17\.0, iOS 17\.0, \*\) \{\s+StrideWidgetsBundle\.main\(\)\s+\} else \{\s+StrideLegacyWidgetsBundle\.main\(\)/);
    expect(bundleSource.match(/StrideCompactWidget\(\)/g)).toHaveLength(2);
  });

  it('ships a separate flat Compact gallery kind without chooser or inline completion', () => {
    const widgetsDir = path.resolve(__dirname, '..', 'widgets-ios');
    const compactSource = fs.readFileSync(
      path.join(widgetsDir, 'StrideCompactWidget.swift'),
      'utf8'
    );
    const bundleSource = fs.readFileSync(
      path.join(widgetsDir, 'StrideWidgetsBundle.swift'),
      'utf8'
    );

    expect(compactSource).toContain('let strideCompactWidgetKind = "StrideCompactWidget"');
    expect(compactSource).toContain('sections.flatMap(\\.items)');
    expect(compactSource).toContain('.configurationDisplayName("Compact")');
    expect(compactSource).not.toContain('Button(intent:');
    expect(compactSource).not.toContain('WidgetConfigurationIntent');
    expect(compactSource).toContain('widgetFamily != .systemSmall');
    expect(compactSource).toContain('Link(destination: safeStrideURL(payload.focusUri))');
    expect(bundleSource).toContain('StrideCompactWidget()');
  });

  it('opens canonical Focus from blank space in every Tasks and Compact family while keeping explicit destinations', () => {
    const widgetsDir = path.resolve(__dirname, '..', 'widgets-ios');
    const tasksSource = fs.readFileSync(path.join(widgetsDir, 'StrideTasksWidget.swift'), 'utf8');
    const compactSource = fs.readFileSync(path.join(widgetsDir, 'StrideCompactWidget.swift'), 'utf8');
    const defaultURL = '.widgetURL(safeStrideURL(StrideWidgetListNavigation.defaultDestination))';


    expect(tasksSource).toContain('focusUri: nonEmpty(openUri) ?? focusUri');
    for (const source of [tasksSource, compactSource]) {
      expect(source).toContain(defaultURL);
      expect(source.match(/\.widgetURL\(/g)).toHaveLength(1);
      expect(source).not.toContain('widgetFamily == .systemSmall ? safeStrideURL(payload.focusUri)');
      expect(source).toContain('Link(destination: safeStrideURL(payload.focusUri))');
      expect(source).toContain('Link(destination: safeStrideURL(payload.quickCaptureUri))');
    }
    expect(tasksSource).toMatch(/Link\(destination: safeStrideURL\(payload\.focusUri\)\) \{\s+widgetHeader\(/);
    expect(compactSource).toMatch(/Link\(destination: safeStrideURL\(payload\.focusUri\)\) \{\s+compactHeader\(/);
    expect(tasksSource).not.toContain('if widgetFamily == .systemSmall {\n                        widgetHeader(');
    expect(compactSource).not.toContain('if widgetFamily == .systemSmall {\n                        compactHeader(');
    expect(tasksSource).toContain('Link(destination: safeStrideURL(StrideWidgetListNavigation.defaultDestination))');
    expect(tasksSource).toContain('Link(destination: safeStrideURL(item.openUri ?? payload.focusUri))');
    expect(compactSource).toContain('Link(destination: safeStrideURL(item.openUri ?? payload.focusUri))');
  });

  it('drops rows that do not fit without presenting a false empty state at large text sizes', () => {
    const widgetsDir = path.resolve(__dirname, '..', 'widgets-ios');
    const tasksSource = fs.readFileSync(
      path.join(widgetsDir, 'StrideTasksWidget.swift'),
      'utf8'
    );
    const compactSource = fs.readFileSync(
      path.join(widgetsDir, 'StrideCompactWidget.swift'),
      'utf8'
    );

    expect(tasksSource).toContain('let hasSourceTasks = !sourceSections(for: payload).isEmpty');
    expect(tasksSource).toContain('if !hasSourceTasks {');
    expect(tasksSource).toContain('let fittingRows = max(0, Int(floor(');
    expect(tasksSource).not.toContain('fittingRows = 1');
    expect(tasksSource).toContain('availableHeight - metrics.padding * 2 - metrics.headerHeight - metrics.sectionSpacing');

    expect(compactSource).toContain('let sourceItems = focusItems(payload)');
    expect(compactSource).toContain('if sourceItems.isEmpty {');
    expect(compactSource).toContain('} else if !items.isEmpty {');
  });

  it('copies the canonical action store and registers every new Swift source only in the widget target', () => {
    const mobileRoot = path.resolve(__dirname, '..');
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stride-ios-widget-'));
    try {
      const copied = copySharedWidgetActionStore(mobileRoot, temporaryRoot);
      expect(copied).toBe(SHARED_WIDGET_ACTION_STORE);
      expect(fs.readFileSync(path.join(temporaryRoot, copied), 'utf8')).toBe(
        fs.readFileSync(
          path.join(mobileRoot, IOS_WIDGET_MODULE_FOLDER, SHARED_WIDGET_ACTION_STORE),
          'utf8'
        )
      );
      const taskItemSource = 'StrideWidgetTaskItem.swift';
      expect(fs.readFileSync(path.join(temporaryRoot, taskItemSource), 'utf8')).toBe(
        fs.readFileSync(path.join(mobileRoot, IOS_WIDGET_MODULE_FOLDER, taskItemSource), 'utf8')
      );

      const calls = [];
      const xcodeProject = {
        hash: { project: { objects: { PBXNativeTarget: { WIDGET_TARGET: { buildPhases: [] } } } } },
        hasFile: () => false,
        addSourceFile: (...args) => calls.push(args),
      };
      const added = ensureWidgetSwiftSourcesInTarget(xcodeProject, {
        swiftFiles: [
          'StrideTasksWidget.swift',
          'StrideTasksWidgetIntents.swift',
          SHARED_WIDGET_ACTION_STORE,
          taskItemSource,
        ],
        groupKey: 'WIDGET_GROUP',
        targetUuid: 'WIDGET_TARGET',
      });

      expect(added).toEqual([
        'StrideTasksWidget.swift',
        'StrideTasksWidgetIntents.swift',
        SHARED_WIDGET_ACTION_STORE,
        taskItemSource,
      ]);
      expect(calls).toEqual([
        ['StrideTasksWidget.swift', { target: 'WIDGET_TARGET' }, 'WIDGET_GROUP'],
        ['StrideTasksWidgetIntents.swift', { target: 'WIDGET_TARGET' }, 'WIDGET_GROUP'],
        [SHARED_WIDGET_ACTION_STORE, { target: 'WIDGET_TARGET' }, 'WIDGET_GROUP'],
        [taskItemSource, { target: 'WIDGET_TARGET' }, 'WIDGET_GROUP'],
      ]);
      expect(calls.some(([, options]) => options.target !== 'WIDGET_TARGET')).toBe(false);
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('ships App Intents sources for Siri Inbox capture and v1 Shortcuts actions', () => {
    const sourceDir = path.resolve(__dirname, '..', APP_INTENTS_FOLDER);
    const source = fs.readFileSync(
      path.join(sourceDir, 'StrideSiriCaptureIntents.swift'),
      'utf8'
    );

    expect(collectSwiftFiles(sourceDir)).toContain('StrideSiriCaptureIntents.swift');
    expect(source).toContain('struct StrideSiriCaptureIntent: AppIntent');
    expect(source).toContain('struct StrideOpenListIntent: AppIntent');
    expect(source).toContain('enum StrideShortcutList: String, AppEnum');
    expect(source).toContain('struct StrideSiriCaptureShortcuts: AppShortcutsProvider');
    expect(source).toContain('"Capture in \\(.applicationName)"');
    const phraseBlock = source.match(/phrases:\s*\[[\s\S]*?\]/)?.[0] ?? '';
    expect(phraseBlock).not.toContain('\\(\\.$task)');
    expect(source).toContain('stride');
    expect(source).toContain('/capture');
    expect(source).toContain('/open-feature');
    expect(source).toContain('requestId');
    expect(source).toContain('UUID().uuidString');
    expect(source).toContain('@Parameter(title: "Project")');
    expect(source).toContain('@Parameter(title: "Tags")');
    expect(source).toContain('URLQueryItem(name: "project"');
    expect(source).toContain('URLQueryItem(name: "tags"');
    expect(source).toContain('case focus');
    expect(source).toContain('case review');
    expect(source).toContain('@Parameter(title: "List", default: StrideShortcutList.inbox)');
    expect(source).toContain('var list: StrideShortcutList');
    expect(source).not.toContain('var list: StrideShortcutList = .inbox');
    expect(source).toContain('.foreground(.immediate)');
  });

  it('ships a background capture intent that only writes the pending-captures queue', () => {
    const sourceDir = path.resolve(__dirname, '..', APP_INTENTS_FOLDER);
    const source = fs.readFileSync(
      path.join(sourceDir, 'StrideSiriCaptureIntents.swift'),
      'utf8'
    );

    expect(source).toContain('struct StrideBackgroundCaptureIntent: AppIntent');
    expect(source).toContain('"pending-captures"');

    const backgroundIntent = source.slice(source.indexOf('struct StrideBackgroundCaptureIntent'));

    expect(backgroundIntent).toContain('.background');
    expect(backgroundIntent).not.toContain('.foreground');
    expect(backgroundIntent).not.toContain('UIApplication');
    expect(backgroundIntent).not.toContain('StrideSiriCaptureLauncher.open');


    expect(source).not.toContain('sqlite');
    expect(source).not.toContain('SQLite');
  });

  it('renames the background capture intent to "Add to Stride" with due/start date params (#980 stage 1)', () => {
    const sourceDir = path.resolve(__dirname, '..', APP_INTENTS_FOLDER);
    const source = fs.readFileSync(
      path.join(sourceDir, 'StrideSiriCaptureIntents.swift'),
      'utf8'
    );
    const backgroundIntent = source.slice(
      source.indexOf('struct StrideBackgroundCaptureIntent'),
      source.indexOf('// MARK: - Shortcuts snapshot')
    );

    expect(backgroundIntent).toContain('static var title: LocalizedStringResource = "Add to Stride"');
    expect(backgroundIntent).toContain('@Parameter(title: "Due date")');
    expect(backgroundIntent).toContain('var dueDate: Date?');
    expect(backgroundIntent).toContain('@Parameter(title: "Start date")');
    expect(backgroundIntent).toContain('var startDate: Date?');
    expect(backgroundIntent).toContain('\\.$dueDate');
    expect(backgroundIntent).toContain('\\.$startDate');
    expect(backgroundIntent).toContain('dueDate: dueDate');
    expect(backgroundIntent).toContain('startDate: startDate');
    expect(backgroundIntent).toContain('"Added to Stride."');


    expect(backgroundIntent).not.toMatch(/dialog:\s*"[^"]*Inbox[^"]*"/);
  });

  it('ships a background, read-only Get Stride Tasks intent over the shortcuts snapshot (#980 stage 2)', () => {
    const sourceDir = path.resolve(__dirname, '..', APP_INTENTS_FOLDER);
    const source = fs.readFileSync(
      path.join(sourceDir, 'StrideSiriCaptureIntents.swift'),
      'utf8'
    );

    expect(source).toContain('struct StrideGetTasksIntent: AppIntent');
    expect(source).toContain('enum StrideGetTasksList: String, AppEnum');
    expect(source).toContain('stride-ios-shortcuts-snapshot');
    expect(source).toContain('UserDefaults(suiteName: appGroup)');


    expect(source).toContain('@available(iOS 16.0, *)\nprivate enum StrideShortcutsSnapshotStore');

    const getTasksIntent = source.slice(source.indexOf('struct StrideGetTasksIntent'));
    const getTasksIntentBody = getTasksIntent.slice(0, getTasksIntent.indexOf('\n}\n'));
    expect(getTasksIntentBody).toContain('.background');
    expect(getTasksIntentBody).not.toContain('.foreground');
    expect(getTasksIntentBody).not.toContain('UIApplication');


    expect(getTasksIntentBody).not.toContain('sqlite');
    expect(getTasksIntentBody).not.toContain('SQLite');
  });

  it('ships a Task entity (iOS 16+) with IndexedEntity Spotlight indexing guarded to iOS 18+ (#980 stage 3)', () => {
    const sourceDir = path.resolve(__dirname, '..', APP_INTENTS_FOLDER);
    const source = fs.readFileSync(
      path.join(sourceDir, 'StrideSiriCaptureIntents.swift'),
      'utf8'
    );

    expect(source).toContain('@available(iOS 16.0, *)\nstruct StrideTaskEntity: AppEntity');
    expect(source).toContain('static var defaultQuery = StrideTaskEntityQuery()');
    expect(source).toContain('struct StrideTaskEntityQuery: EntityStringQuery');
    expect(source).toContain('@available(iOS 18.0, *)\nextension StrideTaskEntity: IndexedEntity');
    expect(source).toContain('CSSearchableIndex.default().indexAppEntities(');
    expect(source).toContain('@available(iOS 18.0, *)\nenum StrideShortcutsSpotlightIndexer');
    expect(source).toContain('let deepLink: String?');
    expect(source).toContain('validatedTaskURL(item.deepLink, expectedTaskId: item.id)');
    expect(source).toContain('URLQueryItem(name: "task", value: taskId)');
    expect(source).toContain('return identifiers.compactMap { itemById[$0] }');


    const getTasksIntent = source.slice(
      source.indexOf('struct StrideGetTasksIntent'),
      source.indexOf('enum StrideShortcutsSpotlightIndexer')
    );
    expect(getTasksIntent).not.toContain('reindexIfNeeded');


    expect(getTasksIntent).toContain('overridden by \\(\\.$project) if set');


    expect(source).toContain('formatter.locale = Locale(identifier: "en_US_POSIX")');


    const spotlightIndexer = source.slice(source.indexOf('enum StrideShortcutsSpotlightIndexer'));
    const deleteIndex = spotlightIndexer.indexOf('deleteAllSearchableItems');
    const indexEntities = spotlightIndexer.indexOf('indexAppEntities(entities)');
    expect(deleteIndex).toBeGreaterThan(-1);
    expect(indexEntities).toBeGreaterThan(deleteIndex);
  });

  it('reports bounded or stale snapshot reads and refuses ambiguous project names', () => {
    const sourceDir = path.resolve(__dirname, '..', APP_INTENTS_FOLDER);
    const source = fs.readFileSync(
      path.join(sourceDir, 'StrideSiriCaptureIntents.swift'),
      'utf8'
    );

    expect(source).toContain('private static let staleAfter: TimeInterval = 24 * 60 * 60');
    expect(source).toContain('static func knownOmittedTaskCount(forList list: StrideGetTasksList) -> Int?');
    expect(source).toContain('let omittedCount = (match["coverage"] as? [String: Any])?["omitted"] as? NSNumber');
    expect(source).toContain('case ambiguous');
    expect(source).toContain('More than one project has that name.');
    expect(source).toContain('eligible task(s) from this \\(sourceLabel) were omitted');
    expect(source).toContain('This \\(sourceLabel) may contain more tasks.');
    expect(source).toContain('task(s) in a stale snapshot.');
  });

  it('wires Spotlight reindexing into AppDelegate launch, guarded to iOS 18+, idempotently', () => {
    const appDelegate = `public class AppDelegate: ExpoAppDelegate {
  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    bindReactNativeFactory(factory)

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}
`;

    const patched = addSiriShortcutsRegistrationToAppDelegate(appDelegate);

    expect(patched).toContain('if #available(iOS 18.0, *)');
    expect(patched).toContain(`${SPOTLIGHT_INDEXER}.reindexIfNeeded()`);
    expect(addSiriShortcutsRegistrationToAppDelegate(patched)).toBe(patched);
  });

  it('registers App Shortcuts from AppDelegate idempotently', () => {
    const appDelegate = `public class AppDelegate: ExpoAppDelegate {
  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    bindReactNativeFactory(factory)

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}
`;

    const patched = addSiriShortcutsRegistrationToAppDelegate(appDelegate);

    expect(patched).toContain('if #available(iOS 16.0, *)');
    expect(patched).toContain(`${SIRI_CAPTURE_SHORTCUTS_PROVIDER}.updateAppShortcutParameters()`);
    expect(addSiriShortcutsRegistrationToAppDelegate(patched)).toBe(patched);
  });

  it('adds App Intents Swift files to the main target once', () => {
    const calls = [];
    const xcodeProject = {
      hasFile: (filePath) => filePath === 'Stride/Existing.swift',
      addSourceFile: (...args) => calls.push(args),
    };

    expect(ensureSourceFileInTarget(xcodeProject, {
      filePath: 'Stride/StrideSiriCaptureIntents.swift',
      groupKey: 'MAIN_GROUP',
      targetUuid: 'MAIN_TARGET',
    })).toBe(true);
    expect(ensureSourceFileInTarget(xcodeProject, {
      filePath: 'Stride/Existing.swift',
      groupKey: 'MAIN_GROUP',
      targetUuid: 'MAIN_TARGET',
    })).toBe(false);

    expect(calls).toEqual([
      [
        'Stride/StrideSiriCaptureIntents.swift',
        { target: 'MAIN_TARGET' },
        'MAIN_GROUP',
      ],
    ]);
  });
});


describe('Control Center quick capture intent', () => {
  const read = (relativePath) => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
  const intentBlock = (source) => {
    const start = source.indexOf('struct StrideOpenQuickCaptureIntent: AppIntent');
    expect(start).toBeGreaterThan(-1);
    return source.slice(start, source.indexOf('\n}\n', start));
  };

  it('exists in both targets with the same title and foreground mode', () => {
    const appCopy = intentBlock(read('ios-app-intents/StrideSiriCaptureIntents.swift'));
    const extensionCopy = intentBlock(read('widgets-ios/StrideCaptureLockWidget.swift'));

    for (const copy of [appCopy, extensionCopy]) {
      expect(copy).toContain('"Add Task"');
      expect(copy).toContain('.foreground(.immediate)');
      expect(copy).toMatch(/openAppWhenRun: Bool \{\s*true/);
      expect(copy).toContain('-> some IntentResult {');
    }

    expect(appCopy).toContain('StrideSiriCaptureLauncher.openQuickCapture()');
    expect(extensionCopy).not.toContain('OpenURLIntent(');
  });
});
