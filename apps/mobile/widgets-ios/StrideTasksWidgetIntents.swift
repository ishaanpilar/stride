import AppIntents
import Foundation
import WidgetKit

private let strideDefaultWidgetListId = "focus"
private let strideSavedFilterListPrefix = "filter:"

@available(iOSApplicationExtension 17.0, iOS 17.0, *)
struct StrideWidgetListEntity: AppEntity {
    let id: String
    let name: String

    static var typeDisplayRepresentation: TypeDisplayRepresentation {
        TypeDisplayRepresentation(name: "List")
    }

    static var defaultQuery = StrideWidgetListEntityQuery()

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)")
    }
}

@available(iOSApplicationExtension 17.0, iOS 17.0, *)
struct StrideWidgetListEntityQuery: EntityQuery {
    func entities(for identifiers: [String]) async throws -> [StrideWidgetListEntity] {
        let options = Self.options()
        return identifiers.compactMap { id in options.first(where: { $0.id == id }) }
    }

    func suggestedEntities() async throws -> [StrideWidgetListEntity] {
        Self.options()
    }

    private static func options() -> [StrideWidgetListEntity] {
        let payload = StrideTasksWidgetSnapshotStore.configurationPayload
        let fallbackNames = [
            "focus": "Focus",
            "inbox": "Inbox",
            "next": "Next",
            "upcoming": "Upcoming",
            "waiting": "Waiting",
            "someday": "Someday",
        ]
        var seen = Set<String>()
        var options: [StrideWidgetListEntity] = []

        for id in ["focus", "inbox", "next", "upcoming", "waiting", "someday"] {
            let name = payload.title(forList: id) ?? fallbackNames[id] ?? id
            if seen.insert(id).inserted {
                options.append(StrideWidgetListEntity(id: id, name: name))
            }
        }

        for filter in payload.savedFilters ?? [] {
            let id = strideSavedFilterListPrefix + filter.id
            guard !filter.id.isEmpty, !filter.name.isEmpty, seen.insert(id).inserted else { continue }
            options.append(StrideWidgetListEntity(id: id, name: filter.name))
        }

        return options
    }
}

@available(iOSApplicationExtension 17.0, iOS 17.0, *)
struct StrideTasksWidgetConfigurationIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Stride List"
    static var description = IntentDescription("Choose the Stride list this widget shows.")

    @Parameter(title: "List")
    var list: StrideWidgetListEntity?


    @Parameter(
        title: "Include available actions",
        description: "Focus only: adds Next Actions whose start date has arrived. Not tasks marked in progress.",
        default: false
    )
    var includeAvailableActions: Bool

    init() {}

    init(list: StrideWidgetListEntity?) {
        self.list = list
    }


    var payloadListId: String {
        let listId = list?.id ?? strideDefaultWidgetListId
        return listId == strideDefaultWidgetListId && includeAvailableActions ? strideFocusAvailableListId : listId
    }
}

@available(iOSApplicationExtension 17.0, iOS 17.0, *)
struct StrideTasksWidgetAppIntentProvider: AppIntentTimelineProvider {
    func placeholder(in _: Context) -> StrideTasksWidgetEntry {
        StrideTasksWidgetEntry(date: Date(), payload: .fallback, pendingActions: [], listId: "focus")
    }

    func snapshot(
        for configuration: StrideTasksWidgetConfigurationIntent,
        in context: Context
    ) async -> StrideTasksWidgetEntry {
        entry(for: configuration, family: context.family)
    }

    func timeline(
        for configuration: StrideTasksWidgetConfigurationIntent,
        in context: Context
    ) async -> Timeline<StrideTasksWidgetEntry> {
        let now = Date()
        let entries = StrideTasksWidgetSnapshotStore.timelineEntries(
            for: context.family,
            listId: configuration.payloadListId,
            now: now
        )
        let refresh = Calendar.current.date(byAdding: .minute, value: 30, to: now)
            ?? now.addingTimeInterval(1800)
        return Timeline(entries: entries, policy: .after(refresh))
    }

    private func entry(
        for configuration: StrideTasksWidgetConfigurationIntent,
        family: WidgetFamily,
        date: Date = Date()
    ) -> StrideTasksWidgetEntry {
        StrideTasksWidgetSnapshotStore.entry(
            for: family,
            listId: configuration.payloadListId,
            date: date
        )
    }
}


@available(iOSApplicationExtension 17.0, iOS 17.0, *)
struct StrideOpenWidgetTaskIntent: AppIntent {
    static var title: LocalizedStringResource = "Open Task"
    static var description = IntentDescription("Opens a Stride task.")
    static var isDiscoverable: Bool { false }

#if compiler(>=6.0)
    @available(iOS 26.0, *)
    static var supportedModes: IntentModes { .foreground(.immediate) }
#endif

    @available(*, deprecated, message: "Use supportedModes with newer App Intents SDKs.")
    static var openAppWhenRun: Bool { true }

    @Parameter(title: "Task identifier")
    var taskId: String

    init() { taskId = "" }
    init(taskId: String) { self.taskId = taskId }

    @MainActor
    func perform() async throws -> some IntentResult { .result() }
}

private enum StrideWidgetTaskIntentError: LocalizedError {
    case unavailableTask
    case unavailableAction

    var errorDescription: String? {
        switch self {
        case .unavailableTask:
            return "This task is no longer available in the widget."
        case .unavailableAction:
            return "This widget action is no longer available."
        }
    }
}

@available(iOSApplicationExtension 17.0, iOS 17.0, *)
struct StrideCompleteWidgetTaskIntent: AppIntent {
    static var title: LocalizedStringResource = "Complete Stride Task"
    static var description = IntentDescription("Queues a Stride task for completion.")
    static var isDiscoverable: Bool { false }

#if compiler(>=6.0)
    @available(iOS 26.0, *)
    static var supportedModes: IntentModes {
        .background
    }
#endif

    @available(*, deprecated, message: "Use supportedModes with newer App Intents SDKs.")
    static var openAppWhenRun: Bool { false }

    @Parameter(title: "Task identifier")
    var taskId: String

    @Parameter(title: "Completion token")
    var completionToken: String

    init() {
        taskId = ""
        completionToken = ""
    }

    init(taskId: String, completionToken: String) {
        self.taskId = taskId
        self.completionToken = completionToken
    }

    func perform() async throws -> some IntentResult {
        guard StrideTasksWidgetSnapshotStore.contains(
            taskId: taskId,
            completionToken: completionToken
        ) else {
            throw StrideWidgetTaskIntentError.unavailableTask
        }

        try StrideWidgetActionStore.appGroupStore().enqueue(
            taskId: taskId,
            token: completionToken
        )
        WidgetCenter.shared.reloadTimelines(ofKind: strideWidgetKind)
        return .result()
    }
}

@available(iOSApplicationExtension 17.0, iOS 17.0, *)
struct StrideUndoWidgetTaskIntent: AppIntent {
    static var title: LocalizedStringResource = "Undo Stride Task Completion"
    static var description = IntentDescription("Cancels a queued Stride task completion.")
    static var isDiscoverable: Bool { false }

#if compiler(>=6.0)
    @available(iOS 26.0, *)
    static var supportedModes: IntentModes {
        .background
    }
#endif

    @available(*, deprecated, message: "Use supportedModes with newer App Intents SDKs.")
    static var openAppWhenRun: Bool { false }

    @Parameter(title: "Action identifier")
    var actionId: String

    init() {
        actionId = ""
    }

    init(actionId: String) {
        self.actionId = actionId
    }

    func perform() async throws -> some IntentResult {
        let store = try StrideWidgetActionStore.appGroupStore()
        guard try store.cancel(id: actionId) else {
            throw StrideWidgetTaskIntentError.unavailableAction
        }

        WidgetCenter.shared.reloadTimelines(ofKind: strideWidgetKind)
        return .result()
    }
}
