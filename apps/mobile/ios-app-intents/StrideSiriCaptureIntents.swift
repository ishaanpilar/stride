import AppIntents
import CoreSpotlight
import UIKit
import UniformTypeIdentifiers

private enum StrideSiriCaptureLauncher {
    static func appURL(path: String, queryItems: [URLQueryItem]) -> URL? {
        var components = URLComponents()
        components.scheme = "stride"
        components.host = ""
        components.path = path
        components.queryItems = queryItems
        return components.url
    }

    static func trimmed(_ value: String?) -> String? {
        let trimmedValue = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmedValue.isEmpty ? nil : trimmedValue
    }

    static func normalizedCommaList(_ value: String?) -> String? {
        guard let value else { return nil }
        let items = value
            .split(separator: ",")
            .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        return items.isEmpty ? nil : items.joined(separator: ",")
    }

    static func captureURL(task: String, note: String?, tags: String?, project: String?) -> URL? {
        var queryItems = [
            URLQueryItem(name: "title", value: task),
            URLQueryItem(name: "requestId", value: UUID().uuidString)
        ]
        if let note = trimmed(note) {
            queryItems.append(URLQueryItem(name: "note", value: note))
        }
        if let tags = normalizedCommaList(tags) {
            queryItems.append(URLQueryItem(name: "tags", value: tags))
        }
        if let project = trimmed(project) {
            queryItems.append(URLQueryItem(name: "project", value: project))
        }

        return appURL(path: "/capture", queryItems: queryItems)
    }

    static func featureURL(feature: String) -> URL? {
        appURL(
            path: "/open-feature",
            queryItems: [URLQueryItem(name: "feature", value: feature)]
        )
    }

    static func taskURL(taskId: String) -> URL? {
        var components = URLComponents()
        components.scheme = "stride"
        components.host = "open"
        components.queryItems = [URLQueryItem(name: "task", value: taskId)]
        return components.url
    }

    static func validatedTaskURL(_ rawValue: String?, expectedTaskId: String) -> URL? {
        guard let rawValue,
              let url = URL(string: rawValue),
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.scheme?.lowercased() == "stride",
              components.host?.lowercased() == "open",
              components.queryItems?.first(where: { $0.name == "task" })?.value == expectedTaskId else {
            return taskURL(taskId: expectedTaskId)
        }
        return url
    }

    @MainActor
    static func open(_ url: URL) {

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
            UIApplication.shared.open(url, options: [:], completionHandler: nil)
        }
    }

    @MainActor
    static func openCapture(task: String, note: String?, tags: String?, project: String?) {
        guard let url = captureURL(task: task, note: note, tags: tags, project: project) else {
            return
        }
        open(url)
    }

    @MainActor
    static func openFeature(feature: String) {
        guard let url = featureURL(feature: feature) else {
            return
        }
        open(url)
    }


    @MainActor
    static func openQuickCapture() {
        guard let url = appURL(
            path: "/capture-quick",
            queryItems: [
                URLQueryItem(name: "mode", value: "text"),
                URLQueryItem(name: "source", value: "control")
            ]
        ) else {
            return
        }
        open(url)
    }
}


@available(iOS 16.0, *)
struct StrideOpenQuickCaptureIntent: AppIntent {
    static var title: LocalizedStringResource = "Add Task"
    static var description = IntentDescription("Opens Stride quick capture.")

#if compiler(>=6.0)
    @available(iOS 26.0, *)
    static var supportedModes: IntentModes {
        .foreground(.immediate)
    }
#endif

    @available(*, deprecated, message: "Use supportedModes with newer App Intents SDKs.")
    static var openAppWhenRun: Bool {
        true
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        StrideSiriCaptureLauncher.openQuickCapture()
        return .result()
    }
}


@available(iOS 17.0, *)
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
    func perform() async throws -> some IntentResult {
        guard !taskId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              taskId.utf16.count <= 1_024,
              !taskId.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
              let url = StrideSiriCaptureLauncher.taskURL(taskId: taskId)
        else { return .result() }
        StrideSiriCaptureLauncher.open(url)
        return .result()
    }
}

@available(iOS 16.0, *)
enum StrideShortcutList: String, AppEnum {
    case inbox
    case focus
    case waiting
    case someday
    case projects
    case review
    case calendar

    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Stride List")
    static var caseDisplayRepresentations: [StrideShortcutList: DisplayRepresentation] = [
        .inbox: "Inbox",
        .focus: "Focus",
        .waiting: "Waiting",
        .someday: "Someday",
        .projects: "Projects",
        .review: "Review",
        .calendar: "Calendar"
    ]

    var featureValue: String {
        switch self {
        case .inbox:
            return "inbox"
        case .focus:
            return "focus"
        case .waiting:
            return "waiting"
        case .someday:
            return "someday"
        case .projects:
            return "projects"
        case .review:
            return "review"
        case .calendar:
            return "calendar"
        }
    }

    var dialogTitle: String {
        switch self {
        case .inbox:
            return "Inbox"
        case .focus:
            return "Focus"
        case .waiting:
            return "Waiting"
        case .someday:
            return "Someday"
        case .projects:
            return "Projects"
        case .review:
            return "Review"
        case .calendar:
            return "Calendar"
        }
    }
}

@available(iOS 16.0, *)
struct StrideSiriCaptureIntent: AppIntent {
    static var title: LocalizedStringResource = "Capture to Stride"
    static var description = IntentDescription("Captures a task into the Stride Inbox for later processing.")

#if compiler(>=6.0)
    @available(iOS 26.0, *)
    static var supportedModes: IntentModes {
        .foreground(.immediate)
    }
#endif

    @available(*, deprecated, message: "Use supportedModes with newer App Intents SDKs.")
    static var openAppWhenRun: Bool {
        true
    }

    @Parameter(title: "Task")
    var task: String

    @Parameter(title: "Note")
    var note: String?

    @Parameter(title: "Tags")
    var tags: String?

    @Parameter(title: "Project")
    var project: String?

    static var parameterSummary: some ParameterSummary {
        Summary("Capture \(\.$task)") {
            \.$note
            \.$tags
            \.$project
        }
    }

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let trimmedTask = task.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedNote = note?.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedTags = tags?.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedProject = project?.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedTask.isEmpty else {
            return .result(dialog: "Tell Stride what to capture.")
        }

        StrideSiriCaptureLauncher.openCapture(
            task: trimmedTask,
            note: trimmedNote?.isEmpty == false ? trimmedNote : nil,
            tags: trimmedTags?.isEmpty == false ? trimmedTags : nil,
            project: trimmedProject?.isEmpty == false ? trimmedProject : nil
        )
        return .result(dialog: "Review it in Stride.")
    }
}

@available(iOS 16.0, *)
struct StrideOpenListIntent: AppIntent {
    static var title: LocalizedStringResource = "Open Stride List"
    static var description = IntentDescription("Opens a Stride GTD list or workflow view.")

#if compiler(>=6.0)
    @available(iOS 26.0, *)
    static var supportedModes: IntentModes {
        .foreground(.immediate)
    }
#endif

    @available(*, deprecated, message: "Use supportedModes with newer App Intents SDKs.")
    static var openAppWhenRun: Bool {
        true
    }

    @Parameter(title: "List", default: StrideShortcutList.inbox)
    var list: StrideShortcutList

    static var parameterSummary: some ParameterSummary {
        Summary("Open \(\.$list)")
    }

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        StrideSiriCaptureLauncher.openFeature(feature: list.featureValue)
        return .result(dialog: "Opening \(list.dialogTitle) in Stride.")
    }
}


@available(iOS 16.0, *)
struct StrideSavedListEntity: AppEntity {
    let id: String
    let name: String
    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Saved List")
    static var defaultQuery = StrideSavedListQuery()
    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }
}

@available(iOS 16.0, *)
struct StrideSavedListQuery: EntityStringQuery {
    func suggestedEntities() async throws -> [StrideSavedListEntity] {
        StrideSavedListCatalog.load().map { StrideSavedListEntity(id: $0.id, name: $0.name) }
    }

    func entities(for identifiers: [String]) async throws -> [StrideSavedListEntity] {
        let lists = try await suggestedEntities()
        return identifiers.compactMap { id in lists.first { $0.id == id } }
    }

    func entities(matching string: String) async throws -> [StrideSavedListEntity] {
        try await suggestedEntities().filter { $0.name.localizedCaseInsensitiveContains(string) }
    }
}

@available(iOS 16.0, *)
struct StrideOpenSavedListIntent: AppIntent {
    static var title: LocalizedStringResource = "Open Stride Saved List"
    static var description = IntentDescription("Opens a saved Focus filter, including context filters. Save the filter and open Stride once to refresh the available lists.")

#if compiler(>=6.0)
    @available(iOS 26.0, *)
    static var supportedModes: IntentModes { .foreground(.immediate) }
#endif

    @available(*, deprecated, message: "Use supportedModes with newer App Intents SDKs.")
    static var openAppWhenRun: Bool { true }

    @Parameter(title: "Saved List")
    var list: StrideSavedListEntity

    static var parameterSummary: some ParameterSummary { Summary("Open \(\.$list)") }

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard StrideSavedListCatalog.load().contains(where: { $0.id == list.id }),
              let url = StrideSavedListCatalog.destination(id: list.id) else {
            return .result(dialog: "That saved list is unavailable. Open Stride to refresh it, then choose a saved list again.")
        }
        StrideSiriCaptureLauncher.open(url)
        return .result(dialog: "Opening your saved list in Stride.")
    }
}


private enum StridePendingCaptureQueue {
    static let directoryName = "pending-captures"


    static let dateOnlyFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = .current


        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    static func directoryURL() -> URL? {
        FileManager.default
            .urls(for: .documentDirectory, in: .userDomainMask)
            .first?
            .appendingPathComponent(directoryName, isDirectory: true)
    }

    static func enqueue(
        task: String,
        note: String?,
        tags: String?,
        project: String?,
        dueDate: Date? = nil,
        startDate: Date? = nil
    ) -> Bool {
        guard let directory = directoryURL() else { return false }
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let id = UUID().uuidString
            var payload: [String: Any] = [
                "id": id,
                "title": task,
                "createdAt": ISO8601DateFormatter().string(from: Date())
            ]
            if let note = StrideSiriCaptureLauncher.trimmed(note) {
                payload["note"] = note
            }
            if let tags = StrideSiriCaptureLauncher.normalizedCommaList(tags) {
                payload["tags"] = tags
            }
            if let project = StrideSiriCaptureLauncher.trimmed(project) {
                payload["project"] = project
            }
            if let dueDate {
                payload["dueDate"] = dateOnlyFormatter.string(from: dueDate)
            }
            if let startDate {
                payload["startDate"] = dateOnlyFormatter.string(from: startDate)
            }
            let data = try JSONSerialization.data(withJSONObject: payload, options: [])
            try data.write(to: directory.appendingPathComponent("\(id).json"), options: [.atomic])
            return true
        } catch {
            return false
        }
    }
}

@available(iOS 16.0, *)
enum StrideBackgroundCaptureError: Error, CustomLocalizedStringResourceConvertible {
    case emptyTask
    case writeFailed

    var localizedStringResource: LocalizedStringResource {
        switch self {
        case .emptyTask:
            return "Tell Stride what to add."
        case .writeFailed:
            return "Stride could not save the task. Open the app and try again."
        }
    }
}

@available(iOS 16.0, *)
struct StrideBackgroundCaptureIntent: AppIntent {
    static var title: LocalizedStringResource = "Add to Stride"
    static var description = IntentDescription("Silently adds a task to Stride without opening the app. It can file into a project. The item appears the next time Stride opens.")

#if compiler(>=6.0)
    @available(iOS 26.0, *)
    static var supportedModes: IntentModes {
        .background
    }
#endif

    @available(*, deprecated, message: "Use supportedModes with newer App Intents SDKs.")
    static var openAppWhenRun: Bool {
        false
    }

    @Parameter(title: "Task")
    var task: String

    @Parameter(title: "Note")
    var note: String?

    @Parameter(title: "Tags")
    var tags: String?

    @Parameter(title: "Project")
    var project: String?

    @Parameter(title: "Due date")
    var dueDate: Date?

    @Parameter(title: "Start date")
    var startDate: Date?

    static var parameterSummary: some ParameterSummary {
        Summary("Add \(\.$task) to Stride") {
            \.$note
            \.$tags
            \.$project
            \.$dueDate
            \.$startDate
        }
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let trimmedTask = task.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedTask.isEmpty else {
            throw StrideBackgroundCaptureError.emptyTask
        }
        guard StridePendingCaptureQueue.enqueue(
            task: trimmedTask,
            note: note,
            tags: tags,
            project: project,
            dueDate: dueDate,
            startDate: startDate
        ) else {
            throw StrideBackgroundCaptureError.writeFailed
        }


        return .result(dialog: "Added to Stride.")
    }
}


@available(iOS 16.0, *)
private enum StrideShortcutsSnapshotStore {
    static let appGroup = "group.com.ishaanpilar.stride"
    static let snapshotKey = "stride-ios-shortcuts-snapshot"

    private static let staleAfter: TimeInterval = 24 * 60 * 60
    private static let generatedAtFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    enum Freshness {
        case missing
        case invalidTimestamp
        case stale
        case current
    }

    enum ProjectResolution {
        case matched([StrideShortcutsSnapshotItem], omittedCount: Int?)
        case missing
        case ambiguous
    }

    private static func rawSnapshot() -> [String: Any]? {
        guard let defaults = UserDefaults(suiteName: appGroup),
              let jsonString = defaults.string(forKey: snapshotKey),
              let data = jsonString.data(using: .utf8) else {
            return nil
        }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    static func freshness(now: Date = Date()) -> Freshness {
        guard let root = rawSnapshot() else { return .missing }
        guard let rawGeneratedAt = root["generatedAt"] as? String,
              let generatedAt = generatedAtFormatter.date(from: rawGeneratedAt)
                ?? ISO8601DateFormatter().date(from: rawGeneratedAt) else {
            return .invalidTimestamp
        }
        let age = now.timeIntervalSince(generatedAt)
        return age >= 0 && age <= staleAfter ? .current : .stale
    }

    static func knownOmittedTaskCount(forList list: StrideGetTasksList) -> Int? {
        guard let root = rawSnapshot(),
              let coverage = root["coverage"] as? [String: Any],
              let lists = coverage["lists"] as? [String: Any],
              let listCoverage = lists[list.rawValue] as? [String: Any],
              let omitted = listCoverage["omitted"] as? NSNumber else {
            return nil
        }
        return max(0, omitted.intValue)
    }


    static func loadAllItems() -> [StrideShortcutsSnapshotItem] {
        guard let root = rawSnapshot() else { return [] }
        var items: [StrideShortcutsSnapshotItem] = []
        if let lists = root["lists"] as? [String: [[String: Any]]] {
            for entries in lists.values {
                items.append(contentsOf: entries.compactMap(StrideShortcutsSnapshotItem.init(dict:)))
            }
        }
        if let projects = root["projects"] as? [[String: Any]] {
            for project in projects {
                let entries = project["items"] as? [[String: Any]] ?? []
                items.append(contentsOf: entries.compactMap(StrideShortcutsSnapshotItem.init(dict:)))
            }
        }
        var seenIds = Set<String>()
        return items.filter { seenIds.insert($0.id).inserted }
    }

    static func items(forList list: StrideGetTasksList) -> [StrideShortcutsSnapshotItem] {
        guard let root = rawSnapshot(),
              let lists = root["lists"] as? [String: [[String: Any]]],
              let entries = lists[list.rawValue] else {
            return []
        }
        return entries.compactMap(StrideShortcutsSnapshotItem.init(dict:))
    }

    static func items(forProjectNamed name: String) -> ProjectResolution {
        let needle = name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !needle.isEmpty,
              let root = rawSnapshot(),
              let projects = root["projects"] as? [[String: Any]] else {
            return .missing
        }
        let matches = projects.filter {
            ($0["name"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == needle
        }
        guard !matches.isEmpty else { return .missing }
        guard matches.count == 1, let match = matches.first else { return .ambiguous }
        let entries = match["items"] as? [[String: Any]] ?? []
        let omittedCount = (match["coverage"] as? [String: Any])?["omitted"] as? NSNumber
        return .matched(
            entries.compactMap(StrideShortcutsSnapshotItem.init(dict:)),
            omittedCount: omittedCount.map { max(0, $0.intValue) }
        )
    }
}

struct StrideShortcutsSnapshotItem {
    let id: String
    let title: String
    let list: String
    let dueDate: String?
    let startDate: String?
    let projectId: String?
    let projectName: String?
    let deepLink: String?

    init?(dict: [String: Any]) {
        guard let id = dict["id"] as? String, !id.isEmpty,
              let title = dict["title"] as? String, !title.isEmpty else {
            return nil
        }
        self.id = id
        self.title = title
        self.list = dict["list"] as? String ?? ""
        self.dueDate = dict["dueDate"] as? String
        self.startDate = dict["startDate"] as? String
        self.projectId = dict["projectId"] as? String
        self.projectName = dict["projectName"] as? String
        self.deepLink = dict["deepLink"] as? String
    }
}

@available(iOS 16.0, *)
enum StrideGetTasksList: String, AppEnum {
    case inbox
    case focus
    case next
    case waiting
    case someday

    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Stride Task List")
    static var caseDisplayRepresentations: [StrideGetTasksList: DisplayRepresentation] = [
        .inbox: "Inbox",
        .focus: "Focus",
        .next: "Next",
        .waiting: "Waiting",
        .someday: "Someday"
    ]

    var dialogTitle: String {
        switch self {
        case .inbox: return "Inbox"
        case .focus: return "Focus"
        case .next: return "Next"
        case .waiting: return "Waiting"
        case .someday: return "Someday"
        }
    }
}


private enum StrideTaskDueDateDisplay {
    private static let mediumDateOnly: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter
    }()

    private static let shortDateTime: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .short
        formatter.timeStyle = .short
        return formatter
    }()

    private static let isoDateTime: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    static func format(_ raw: String) -> String {
        if let dateOnly = StridePendingCaptureQueue.dateOnlyFormatter.date(from: raw) {
            return mediumDateOnly.string(from: dateOnly)
        }
        if let dateTime = ISO8601DateFormatter().date(from: raw) ?? isoDateTime.date(from: raw) {
            return shortDateTime.string(from: dateTime)
        }
        return raw
    }

    static func date(_ raw: String) -> Date? {
        StridePendingCaptureQueue.dateOnlyFormatter.date(from: raw)
            ?? ISO8601DateFormatter().date(from: raw)
            ?? isoDateTime.date(from: raw)
    }
}


@available(iOS 16.0, *)
struct StrideTaskEntity: AppEntity {
    let id: String
    let title: String
    let listLabel: String
    let dueDate: String?
    let openURL: URL?

    static var typeDisplayRepresentation = TypeDisplayRepresentation(
        name: "Stride Task",
        numericFormat: "\(placeholder: .int) tasks"
    )

    var displayRepresentation: DisplayRepresentation {
        if let dueDate, !dueDate.isEmpty {
            let formattedDueDate = StrideTaskDueDateDisplay.format(dueDate)
            return DisplayRepresentation(title: "\(title)", subtitle: "\(listLabel) · Due \(formattedDueDate)")
        }
        return DisplayRepresentation(title: "\(title)", subtitle: "\(listLabel)")
    }

    static var defaultQuery = StrideTaskEntityQuery()

    init(item: StrideShortcutsSnapshotItem) {
        id = item.id
        title = item.title
        dueDate = item.dueDate
        openURL = StrideSiriCaptureLauncher.validatedTaskURL(item.deepLink, expectedTaskId: item.id)
        if let projectName = item.projectName, !projectName.isEmpty {
            listLabel = projectName
        } else {
            listLabel = StrideGetTasksList(rawValue: item.list)?.dialogTitle ?? item.list.capitalized
        }
    }
}

@available(iOS 16.0, *)
struct StrideTaskEntityQuery: EntityStringQuery {
    func entities(for identifiers: [String]) async throws -> [StrideTaskEntity] {
        let itemById = Dictionary(
            uniqueKeysWithValues: StrideShortcutsSnapshotStore.loadAllItems().map { ($0.id, $0) }
        )
        return identifiers.compactMap { itemById[$0] }.map(StrideTaskEntity.init(item:))
    }

    func entities(matching string: String) async throws -> [StrideTaskEntity] {
        let needle = string.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !needle.isEmpty else { return [] }
        return StrideShortcutsSnapshotStore.loadAllItems()
            .filter { $0.title.lowercased().contains(needle) }
            .prefix(25)
            .map(StrideTaskEntity.init(item:))
    }
}


@available(iOS 18.0, *)
extension StrideTaskEntity: IndexedEntity {
    var attributeSet: CSSearchableItemAttributeSet {
        let attributes = CSSearchableItemAttributeSet(contentType: .item)
        attributes.title = title
        attributes.contentDescription = listLabel
        if let dueDate, let parsedDueDate = StrideTaskDueDateDisplay.date(dueDate) {
            attributes.dueDate = parsedDueDate
        }


        attributes.contentURL = openURL
        return attributes
    }
}

@available(iOS 16.0, *)
struct StrideGetTasksIntent: AppIntent {
    static var title: LocalizedStringResource = "Get Stride Tasks"
    static var description = IntentDescription("Reads up to 50 tasks from a Stride list, as of the last time Stride was open. When Project is set, it is read instead of the list. Never opens the app.")

#if compiler(>=6.0)
    @available(iOS 26.0, *)
    static var supportedModes: IntentModes {
        .background
    }
#endif

    @available(*, deprecated, message: "Use supportedModes with newer App Intents SDKs.")
    static var openAppWhenRun: Bool {
        false
    }

    @Parameter(title: "List", default: StrideGetTasksList.next)
    var list: StrideGetTasksList

    @Parameter(title: "Project")
    var project: String?

    static var parameterSummary: some ParameterSummary {
        Summary("Get tasks from \(\.$list), overridden by \(\.$project) if set")
    }

    func perform() async throws -> some IntentResult & ReturnsValue<[StrideTaskEntity]> & ProvidesDialog {
        let trimmedProject = project?.trimmingCharacters(in: .whitespacesAndNewlines)
        let items: [StrideShortcutsSnapshotItem]
        let omittedCount: Int?
        let sourceLabel: String
        if let trimmedProject, !trimmedProject.isEmpty {
            switch StrideShortcutsSnapshotStore.items(forProjectNamed: trimmedProject) {
            case .matched(let matchedItems, let matchedOmittedCount):
                items = matchedItems
                omittedCount = matchedOmittedCount
                sourceLabel = "project"
            case .missing:
                return .result(value: [], dialog: "That project is not in the current Stride snapshot. Open Stride to refresh it.")
            case .ambiguous:
                return .result(value: [], dialog: "More than one project has that name. Open Stride and choose the project there.")
            }
        } else {
            items = StrideShortcutsSnapshotStore.items(forList: list)
            omittedCount = StrideShortcutsSnapshotStore.knownOmittedTaskCount(forList: list)
            sourceLabel = "list"
        }

        let entities = items.map(StrideTaskEntity.init(item:))
        guard !entities.isEmpty else {
            return .result(value: [], dialog: "No tasks found. Open Stride to refresh this list.")
        }
        let freshness = StrideShortcutsSnapshotStore.freshness()
        if let omittedCount, omittedCount > 0 {
            switch freshness {
            case .current:
                return .result(value: entities, dialog: "Found \(entities.count) task(s); \(omittedCount) eligible task(s) from this \(sourceLabel) were omitted by the snapshot limit.")
            case .missing, .invalidTimestamp, .stale:
                return .result(value: entities, dialog: "Found \(entities.count) task(s) in a stale snapshot; \(omittedCount) eligible task(s) from this \(sourceLabel) were omitted. Open Stride to refresh it.")
            }
        }
        if omittedCount == nil && entities.count >= 50 {
            switch freshness {
            case .current:
                return .result(value: entities, dialog: "Found \(entities.count) task(s) at the snapshot limit. This \(sourceLabel) may contain more tasks.")
            case .missing, .invalidTimestamp, .stale:
                return .result(value: entities, dialog: "Found \(entities.count) task(s) at the limit in a stale snapshot. This \(sourceLabel) may contain more tasks. Open Stride to refresh it.")
            }
        }
        switch freshness {
        case .current:
            return .result(value: entities, dialog: "Found \(entities.count) task(s).")
        case .missing, .invalidTimestamp, .stale:
            return .result(value: entities, dialog: "Found \(entities.count) task(s) in a stale snapshot. Open Stride to refresh it.")
        }
    }
}


@available(iOS 18.0, *)
enum StrideShortcutsSpotlightIndexer {
    static func reindexIfNeeded() {
        let items = StrideShortcutsSnapshotStore.loadAllItems()
        let entities = items.map(StrideTaskEntity.init(item:))
        Task {


            try? await CSSearchableIndex.default().deleteAllSearchableItems()
            guard !entities.isEmpty else { return }
            try? await CSSearchableIndex.default().indexAppEntities(entities)
        }
    }
}

@available(iOS 16.0, *)
struct StrideSiriCaptureShortcuts: AppShortcutsProvider {
    static var shortcutTileColor: ShortcutTileColor {
        .blue
    }

    @AppShortcutsBuilder
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: StrideSiriCaptureIntent(),
            phrases: [
                "Capture in \(.applicationName)",
                "Add to \(.applicationName)",
                "Create a task in \(.applicationName)"
            ],
            shortTitle: "Capture Task",
            systemImageName: "tray.and.arrow.down"
        )
        AppShortcut(
            intent: StrideOpenListIntent(),
            phrases: [
                "Open \(.applicationName)",
                "Open a list in \(.applicationName)",
                "Show \(.applicationName)"
            ],
            shortTitle: "Open List",
            systemImageName: "list.bullet"
        )
    }
}
