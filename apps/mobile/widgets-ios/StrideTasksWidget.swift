import AppIntents
import SwiftUI
import WidgetKit

let strideWidgetKind = "StrideTasksWidget"
private let strideWidgetAppGroup = "group.com.ishaanpilar.stride"
private let strideWidgetPayloadKey = "stride-ios-widget-payload"
private let strideWidgetPayloadKeySmall = "stride-ios-widget-payload-small"
private let strideWidgetPayloadKeyMedium = "stride-ios-widget-payload-medium"
private let strideWidgetPayloadKeyLarge = "stride-ios-widget-payload-large"
private let strideWidgetPayloadKeyExtraLarge = "stride-ios-widget-payload-extra-large"

struct StrideWidgetSection: Decodable {
    let key: String?
    let title: String
    let detail: String?
    let items: [StrideWidgetTaskItem]
}

struct StrideWidgetListPayload: Decodable {
    let title: String
    let dateLabel: String?
    let sections: [StrideWidgetSection]?
    let items: [StrideWidgetTaskItem]?

    let openUri: String?
}

struct StrideWidgetSavedFilter: Decodable {
    let id: String
    let name: String
}

struct StrideWidgetPalette: Decodable {
    let background: String
    let card: String
    let border: String
    let text: String
    let mutedText: String
    let accent: String
    let onAccent: String
    let warning: String?
    let headerWash: String?
}

extension StrideWidgetPalette {
    static let light = StrideWidgetPalette(
        background: "#F8FAFC",
        card: "#FFFFFF",
        border: "#CBD5E1",
        text: "#0F172A",
        mutedText: "#475569",
        accent: "#2563EB",
        onAccent: "#FFFFFF",
        warning: "#DC2626",
        headerWash: "#DBEAFE"
    )

    static let dark = StrideWidgetPalette(
        background: "#111827",
        card: "#1F2937",
        border: "#374151",
        text: "#F9FAFB",
        mutedText: "#CBD5E1",
        accent: "#2563EB",
        onAccent: "#FFFFFF",
        warning: "#FCA5A5",
        headerWash: "#1E3A5F"
    )

    static let oled = StrideWidgetPalette(
        background: "#000000",
        card: "#000000",
        border: "#1F2937",
        text: "#E5E7EB",
        mutedText: "#9CA3AF",
        accent: "#4F9DFF",
        onAccent: "#000000",
        warning: "#FBBF24",
        headerWash: "#4F9DFF2E"
    )
}

struct StrideTasksWidgetPayload: Decodable {
    let headerTitle: String
    let subtitle: String
    let dateLabel: String?

    let focusedCount: Int?
    let items: [StrideWidgetTaskItem]
    let sections: [StrideWidgetSection]?
    let lists: [String: StrideWidgetListPayload]?
    let listTitles: [String: String]?
    let savedFilters: [StrideWidgetSavedFilter]?
    let emptyMessage: String
    let captureLabel: String
    let completeLabel: String?
    let undoLabel: String?
    let focusUri: String
    let quickCaptureUri: String
    let themeMode: String?
    let palette: StrideWidgetPalette
    let upcomingDays: StrideWidgetUpcomingDays?

    static var fallback: StrideTasksWidgetPayload {
        StrideTasksWidgetPayload(
            headerTitle: "Today's Focus",
            subtitle: "Inbox: 0",
            dateLabel: "Today",
            focusedCount: 0,
            items: [],
            sections: [],
            lists: nil,
            listTitles: nil,
            savedFilters: nil,
            emptyMessage: "No tasks",
            captureLabel: "Quick capture",
            completeLabel: "Complete",
            undoLabel: "Undo",
            focusUri: "stride:///focus",
            quickCaptureUri: "stride:///capture-quick?mode=text",
            themeMode: "system",
            palette: .light,
            upcomingDays: nil
        )
    }

    var resolvedCompleteLabel: String {
        nonEmpty(completeLabel) ?? "Complete"
    }

    var resolvedUndoLabel: String {
        nonEmpty(undoLabel) ?? "Undo"
    }

    func selectingList(
        _ listId: String,
        pendingActions: [StrideWidgetPendingAction] = [],
        at date: Date = Date()
    ) -> StrideTasksWidgetPayload {
        var normalizedId = nonEmpty(listId) ?? "focus"

        var focusListId = "focus"
        if normalizedId == strideFocusAvailableListId {
            normalizedId = "focus"
            if lists?[strideFocusAvailableListId] != nil { focusListId = strideFocusAvailableListId }
        }
        let focusPayload = unfilteredSelection(for: focusListId)
        let nextPayload = unfilteredSelection(for: "next")
        let resolvedId = StrideWidgetActionProjection.resolvedListId(
            requestedListId: normalizedId,
            identitiesByList: [
                "focus": focusPayload.sourceTaskItems.map(\.actionIdentity),
                "next": nextPayload.sourceTaskItems.map(\.actionIdentity),
            ],
            pendingActions: pendingActions,
            at: date
        )
        return unfilteredSelection(for: resolvedId == "focus" ? focusListId : resolvedId)
            .filteringHiddenActions(pendingActions, at: date, upcomingOnly: resolvedId == "upcoming")
    }

    func title(forList listId: String) -> String? {
        nonEmpty(lists?[listId]?.title)
            ?? nonEmpty(listTitles?[listId])
            ?? savedFilters?.first(where: { listId == "filter:\($0.id)" }).flatMap { nonEmpty($0.name) }
    }

    var allTaskItems: [StrideWidgetTaskItem] {
        var result = items
        result.append(contentsOf: sections?.flatMap(\.items) ?? [])
        if let lists {
            for list in lists.values {
                result.append(contentsOf: list.items ?? [])
                result.append(contentsOf: list.sections?.flatMap(\.items) ?? [])
            }
        }
        return result
    }

    private var sourceTaskItems: [StrideWidgetTaskItem] {
        if let sections, !sections.isEmpty {
            return sections.flatMap(\.items)
        }
        return items
    }

    private func unfilteredSelection(for listId: String) -> StrideTasksWidgetPayload {
        if let list = lists?[listId] {
            let isFocus = listId == "focus" || listId == strideFocusAvailableListId
            return replacingRoot(


                title: isFocus ? headerTitle : list.title,
                dateLabel: isFocus ? (list.dateLabel ?? self.dateLabel) : list.dateLabel,
                sections: list.sections ?? [],
                items: list.items ?? [],
                openUri: StrideWidgetListNavigation.destination(
                    for: listId,
                    suppliedOpenUri: list.openUri
                )
            )
        }

        if listId != "focus" {
            return replacingRoot(
                title: title(forList: listId)
                    ?? nonEmpty(listTitles?["savedFilters"])
                    ?? headerTitle,
                dateLabel: nil,
                sections: [],
                items: [],
                openUri: StrideWidgetListNavigation.destination(
                    for: listId,
                    suppliedOpenUri: nil
                )
            )
        }

        return replacingRoot(
            title: headerTitle,
            dateLabel: dateLabel,
            sections: sections ?? [],
            items: items,
            openUri: StrideWidgetListNavigation.destination(
                for: listId,
                suppliedOpenUri: focusUri
            )
        )
    }

    private func filteringHiddenActions(
        _ pendingActions: [StrideWidgetPendingAction],
        at date: Date,
        upcomingOnly: Bool
    ) -> StrideTasksWidgetPayload {
        func isVisible(_ item: StrideWidgetTaskItem) -> Bool {

            if upcomingOnly || item.isUpcomingPreview {
                return true
            }
            return !StrideWidgetActionProjection.isHidden(item.actionIdentity, by: pendingActions, at: date)
        }
        func relabeled(_ item: StrideWidgetTaskItem) -> StrideWidgetTaskItem {
            item.relabeled(days: upcomingDays, now: date)
        }
        let visibleItems = items.filter(isVisible).map(relabeled)
        let visibleSections = sections?.compactMap { section -> StrideWidgetSection? in
            let items = section.items.filter(isVisible).map(relabeled)
            guard !items.isEmpty else { return nil }
            let groupPrefixes = ["context:", "tag:", "project:", "area:", "energy:", "priority:", "person:"]
            let grouped = groupPrefixes.contains { section.key?.hasPrefix($0) == true }
            let hiddenCount = Set(section.items.filter { !isVisible($0) }.map(\.id)).count
            let detail = grouped ? section.detail.flatMap { Int($0) }.map { String(max(0, $0 - hiddenCount)) } : section.detail
            return StrideWidgetSection(
                key: section.key,
                title: section.title,
                detail: detail,
                items: items
            )
        }
        return replacingRoot(
            title: headerTitle,
            dateLabel: dateLabel,
            sections: visibleSections ?? [],
            items: visibleItems,
            openUri: focusUri
        )
    }

    private func replacingRoot(
        title: String,
        dateLabel: String?,
        sections: [StrideWidgetSection],
        items: [StrideWidgetTaskItem],
        openUri: String?
    ) -> StrideTasksWidgetPayload {
        StrideTasksWidgetPayload(
            headerTitle: nonEmpty(title) ?? headerTitle,
            subtitle: subtitle,
            dateLabel: nonEmpty(dateLabel),
            focusedCount: focusedCount,
            items: items,
            sections: sections,
            lists: lists,
            listTitles: listTitles,
            savedFilters: savedFilters,
            emptyMessage: emptyMessage,
            captureLabel: captureLabel,
            completeLabel: completeLabel,
            undoLabel: undoLabel,
            focusUri: nonEmpty(openUri) ?? focusUri,
            quickCaptureUri: quickCaptureUri,
            themeMode: themeMode,
            palette: palette,
            upcomingDays: upcomingDays
        )
    }
}

private extension StrideWidgetTaskItem {
    var actionIdentity: StrideWidgetActionIdentity {
        StrideWidgetActionIdentity(taskId: id, completionToken: isUpcomingPreview ? nil : completionToken)
    }
}


let strideFocusAvailableListId = "focus:available"

func nonEmpty(_ value: String?) -> String? {
    guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
        return nil
    }
    return trimmed
}

struct StrideTasksWidgetEntry: TimelineEntry {
    let date: Date
    let payload: StrideTasksWidgetPayload
    let pendingActions: [StrideWidgetPendingAction]
    let listId: String
}

struct StrideTasksWidgetProvider: TimelineProvider {
    func placeholder(in _: Context) -> StrideTasksWidgetEntry {
        StrideTasksWidgetEntry(date: Date(), payload: .fallback, pendingActions: [], listId: "focus")
    }

    func getSnapshot(in context: Context, completion: @escaping (StrideTasksWidgetEntry) -> Void) {
        completion(StrideTasksWidgetSnapshotStore.entry(for: context.family))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<StrideTasksWidgetEntry>) -> Void) {
        let now = Date()
        let entries = StrideTasksWidgetSnapshotStore.timelineEntries(for: context.family, now: now)
        let refresh = Calendar.current.date(byAdding: .minute, value: 30, to: now) ?? now.addingTimeInterval(1800)
        completion(Timeline(entries: entries, policy: .after(refresh)))
    }

}

enum StrideTasksWidgetSnapshotStore {
    static func entry(
        for family: WidgetFamily,
        listId: String = "focus",
        date: Date = Date()
    ) -> StrideTasksWidgetEntry {
        let pendingActions = (try? StrideWidgetActionStore.appGroupStore().pendingActions()) ?? []
        return StrideTasksWidgetEntry(
            date: date,
            payload: loadPayload(for: family).selectingList(
                listId,
                pendingActions: pendingActions,
                at: date
            ),
            pendingActions: pendingActions,
            listId: listId
        )
    }

    static func timelineEntries(
        for family: WidgetFamily,
        listId: String = "focus",
        now: Date = Date()
    ) -> [StrideTasksWidgetEntry] {
        let payload = loadPayload(for: family)
        let pendingActions = (try? StrideWidgetActionStore.appGroupStore().pendingActions()) ?? []
        let calendar = Calendar.current

        let midnight = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: now))
        let dates = StrideWidgetActionProjection.timelineDates(
            pendingActions: pendingActions,
            now: now
        ) + [midnight].compactMap { $0 }
        return Set(dates).sorted().map { date in
            StrideTasksWidgetEntry(
                date: date,
                payload: payload.selectingList(
                    listId,
                    pendingActions: pendingActions,
                    at: date
                ),
                pendingActions: pendingActions,
                listId: listId
            )
        }
    }

    static func loadPayload(for family: WidgetFamily) -> StrideTasksWidgetPayload {
        guard let defaults = UserDefaults(suiteName: strideWidgetAppGroup) else {
            return .fallback
        }

        let payloadKeys = [payloadKey(for: family), strideWidgetPayloadKey]
        for key in payloadKeys {
            guard
                let jsonString = defaults.string(forKey: key),
                let data = jsonString.data(using: .utf8)
            else {
                continue
            }

            do {
                return try JSONDecoder().decode(StrideTasksWidgetPayload.self, from: data)
            } catch {
                continue
            }
        }

        return .fallback
    }

    static func currentPayloads() -> [StrideTasksWidgetPayload] {
        guard let defaults = UserDefaults(suiteName: strideWidgetAppGroup) else {
            return []
        }

        return payloadKeys.compactMap { key in
            guard
                let jsonString = defaults.string(forKey: key),
                let data = jsonString.data(using: .utf8)
            else {
                return nil
            }
            return try? JSONDecoder().decode(StrideTasksWidgetPayload.self, from: data)
        }
    }

    static func contains(taskId: String, completionToken: String) -> Bool {
        guard let taskId = nonEmpty(taskId), let completionToken = nonEmpty(completionToken) else {
            return false
        }
        return currentPayloads().contains { payload in
            payload.allTaskItems.contains { item in
                !item.isUpcomingPreview && item.id == taskId && item.completionToken == completionToken
            }
        }
    }

    static var configurationPayload: StrideTasksWidgetPayload {
        currentPayloads().first ?? .fallback
    }

    private static let payloadKeys = [
        strideWidgetPayloadKey,
        strideWidgetPayloadKeySmall,
        strideWidgetPayloadKeyMedium,
        strideWidgetPayloadKeyLarge,
        strideWidgetPayloadKeyExtraLarge,
    ]

    private static func payloadKey(for family: WidgetFamily) -> String {
        switch family {
        case .systemSmall:
            return strideWidgetPayloadKeySmall
        case .systemMedium:
            return strideWidgetPayloadKeyMedium
        case .systemLarge:
            return strideWidgetPayloadKeyLarge
        case .systemExtraLarge:
            return strideWidgetPayloadKeyExtraLarge
        default:
            return strideWidgetPayloadKey
        }
    }
}

private struct StrideWidgetMetrics {
    let headerSize: CGFloat
    let dateSize: CGFloat
    let sectionSize: CGFloat
    let taskSize: CGFloat
    let detailSize: CGFloat
    let actionSize: CGFloat
    let rowSpacing: CGFloat
    let sectionSpacing: CGFloat
    let padding: CGFloat
    let taskRowVPadding: CGFloat

    var headerHeight: CGFloat {
        max(actionSize, headerSize + dateSize + 2)
    }

    var rowHeight: CGFloat {
        max(actionSize, taskSize + detailSize + 2) + taskRowVPadding * 2 + rowSpacing
    }

    var sectionHeaderHeight: CGFloat {
        sectionSize + sectionSpacing
    }

    func scaled(by scale: CGFloat) -> StrideWidgetMetrics {
        StrideWidgetMetrics(
            headerSize: headerSize * scale,
            dateSize: dateSize * scale,
            sectionSize: sectionSize * scale,
            taskSize: taskSize * scale,
            detailSize: detailSize * scale,
            actionSize: actionSize * min(scale, 1.2),
            rowSpacing: rowSpacing,
            sectionSpacing: sectionSpacing,
            padding: padding,
            taskRowVPadding: taskRowVPadding
        )
    }

    static func resolve(for family: WidgetFamily) -> StrideWidgetMetrics {
        switch family {
        case .systemExtraLarge:
            return StrideWidgetMetrics(
                headerSize: 18, dateSize: 12, sectionSize: 12, taskSize: 14,
                detailSize: 11, actionSize: 36, rowSpacing: 3,
                sectionSpacing: 7, padding: 16, taskRowVPadding: 2
            )
        case .systemLarge:
            return StrideWidgetMetrics(
                headerSize: 18, dateSize: 12, sectionSize: 12, taskSize: 14,
                detailSize: 11, actionSize: 36, rowSpacing: 3,
                sectionSpacing: 7, padding: 14, taskRowVPadding: 2
            )
        case .systemMedium:
            return StrideWidgetMetrics(
                headerSize: 17, dateSize: 11, sectionSize: 11, taskSize: 13,
                detailSize: 10, actionSize: 34, rowSpacing: 2,
                sectionSpacing: 6, padding: 12, taskRowVPadding: 1
            )
        default:
            return StrideWidgetMetrics(
                headerSize: 15, dateSize: 10, sectionSize: 10, taskSize: 12,
                detailSize: 9, actionSize: 32, rowSpacing: 1,
                sectionSpacing: 5, padding: 12, taskRowVPadding: 0
            )
        }
    }
}

private struct StrideVisibleWidgetSection: Identifiable {
    let id: String
    let title: String?
    let detail: String?
    let items: [StrideWidgetTaskItem]
}

private struct StrideTasksWidgetView: View {
    let entry: StrideTasksWidgetEntry
    @Environment(\.widgetFamily) private var widgetFamily
    @Environment(\.colorScheme) private var colorScheme
    @ScaledMetric(relativeTo: .body) private var typeScale: CGFloat = 1

    var body: some View {
        let payload = entry.payload
        let palette = resolvePalette(payload)
        let metrics = StrideWidgetMetrics.resolve(for: widgetFamily).scaled(by: typeScale)
        let columnCount = widgetFamily == .systemExtraLarge ? 2 : 1
        GeometryReader { geometry in
            let hasSourceTasks = !sourceSections(for: payload).isEmpty
            let columns = resolveVisibleColumns(
                payload: payload,
                availableHeight: geometry.size.height,
                metrics: metrics,
                columns: columnCount
            )
            VStack(alignment: .leading, spacing: metrics.sectionSpacing) {
                HStack(alignment: .center, spacing: 8) {
                    Link(destination: safeStrideURL(payload.focusUri)) {
                        widgetHeader(payload: payload, palette: palette, metrics: metrics)
                    }

                    Spacer(minLength: 4)

                    if widgetFamily != .systemSmall {
                        Link(destination: safeStrideURL(payload.quickCaptureUri)) {
                            Image(systemName: "plus")
                                .font(.system(size: metrics.taskSize, weight: .bold))
                                .foregroundColor(hexColor(palette.onAccent))
                                .frame(width: metrics.actionSize, height: metrics.actionSize)
                                .background(hexColor(palette.accent))
                                .clipShape(Circle())
                        }
                        .accessibilityLabel(Text(payload.captureLabel))
                    }
                }

                if !hasSourceTasks {
                    if widgetFamily == .systemSmall {
                        Text(payload.emptyMessage)
                            .font(.system(size: metrics.taskSize))
                            .foregroundColor(hexColor(palette.mutedText))
                            .lineLimit(2)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    } else {
                        Link(destination: safeStrideURL(StrideWidgetListNavigation.defaultDestination)) {
                            Text(payload.emptyMessage)
                                .font(.system(size: metrics.taskSize))
                                .foregroundColor(hexColor(palette.mutedText))
                                .lineLimit(2)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                } else if !columns.allSatisfy(\.isEmpty), columnCount == 2 {
                    HStack(alignment: .top, spacing: metrics.padding) {
                        widgetColumn(columns[0], payload: payload, palette: palette, metrics: metrics)
                        widgetColumn(columns[1], payload: payload, palette: palette, metrics: metrics)
                    }
                } else if !columns[0].isEmpty {
                    widgetColumn(columns[0], payload: payload, palette: palette, metrics: metrics)
                }

                Spacer(minLength: 0)
            }
            .padding(metrics.padding)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .widgetURL(safeStrideURL(StrideWidgetListNavigation.defaultDestination))
            .strideWidgetBackground(hexColor(palette.background))
        }
    }

    private func widgetHeader(
        payload: StrideTasksWidgetPayload,
        palette: StrideWidgetPalette,
        metrics: StrideWidgetMetrics
    ) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(payload.headerTitle)
                .font(.system(size: metrics.headerSize, weight: .semibold))
                .foregroundColor(hexColor(palette.text))
                .lineLimit(1)
            Text(nonEmpty(payload.dateLabel) ?? payload.subtitle)
                .font(.system(size: metrics.dateSize, weight: .medium))
                .foregroundColor(hexColor(palette.mutedText))
                .lineLimit(1)
        }
    }

    @ViewBuilder
    private func widgetColumn(
        _ sections: [StrideVisibleWidgetSection],
        payload: StrideTasksWidgetPayload,
        palette: StrideWidgetPalette,
        metrics: StrideWidgetMetrics
    ) -> some View {
        VStack(alignment: .leading, spacing: metrics.sectionSpacing) {
            ForEach(sections) { section in
                VStack(alignment: .leading, spacing: metrics.rowSpacing) {
                    if let title = section.title {
                        HStack(alignment: .firstTextBaseline, spacing: 5) {
                            Text(title)
                                .font(.system(size: metrics.sectionSize, weight: .semibold))
                                .foregroundColor(hexColor(palette.text))
                                .lineLimit(1)
                            Spacer(minLength: 2)
                            if let detail = nonEmpty(section.detail) {
                                Text(detail)
                                    .font(.system(size: metrics.detailSize, weight: .medium))
                                    .foregroundColor(hexColor(palette.mutedText))
                                    .lineLimit(1)
                            }
                        }
                    }

                    ForEach(section.items, id: \.id) { item in
                        StrideWidgetTaskRow(
                            item: item,
                            pendingAction: pendingAction(for: item),
                            payload: payload,
                            palette: palette,
                            metrics: metrics,
                            linksTaskDirectly: widgetFamily != .systemSmall
                        )
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }

    private func pendingAction(for item: StrideWidgetTaskItem) -> StrideWidgetPendingAction? {
        StrideWidgetActionProjection.pendingAction(
            for: item.actionIdentity,
            in: entry.pendingActions,
            at: entry.date
        )
    }

    private func sourceSections(for payload: StrideTasksWidgetPayload) -> [StrideWidgetSection] {
        if let sections = payload.sections, !sections.isEmpty {
            return sections
        }
        guard !payload.items.isEmpty else { return [] }
        return [StrideWidgetSection(key: nil, title: "", detail: nil, items: payload.items)]
    }

    private func resolveVisibleColumns(
        payload: StrideTasksWidgetPayload,
        availableHeight: CGFloat,
        metrics: StrideWidgetMetrics,
        columns columnCount: Int
    ) -> [[StrideVisibleWidgetSection]] {
        var columns = Array(repeating: [StrideVisibleWidgetSection](), count: max(1, columnCount))
        var columnIndex = 0
        var remainingHeight = max(
            0,
            availableHeight - metrics.padding * 2 - metrics.headerHeight - metrics.sectionSpacing
        )
        let columnHeight = remainingHeight

        for (sectionIndex, section) in sourceSections(for: payload).enumerated() {
            var itemIndex = 0
            let sectionTitle = nonEmpty(section.title)
            while itemIndex < section.items.count, columnIndex < columns.count {
                let headerCost = sectionTitle == nil ? 0 : metrics.sectionHeaderHeight
                let fittingRows = max(0, Int(floor((remainingHeight - headerCost) / metrics.rowHeight)))
                if fittingRows <= 0 {
                    columnIndex += 1
                    remainingHeight = columnHeight
                    continue
                }

                let take = min(fittingRows, section.items.count - itemIndex)
                guard take > 0 else { break }
                let items = Array(section.items[itemIndex ..< itemIndex + take])
                columns[columnIndex].append(
                    StrideVisibleWidgetSection(
                        id: "\(section.key ?? "section-\(sectionIndex)")-\(columnIndex)-\(itemIndex)",
                        title: sectionTitle,
                        detail: section.detail,
                        items: items
                    )
                )
                itemIndex += take
                remainingHeight -= headerCost + CGFloat(take) * metrics.rowHeight + metrics.sectionSpacing

                if itemIndex < section.items.count {
                    columnIndex += 1
                    remainingHeight = columnHeight
                }
            }
            if columnIndex >= columns.count { break }
        }

        return columns
    }


    private func resolvePalette(_ payload: StrideTasksWidgetPayload) -> StrideWidgetPalette {
        let mode = (payload.themeMode ?? "system")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()

        if mode == "system-oled" {
            return colorScheme == .dark ? .oled : .light
        }
        if mode.isEmpty || mode == "system" {
            return colorScheme == .dark ? .dark : .light
        }

        return payload.palette
    }
}

private struct StrideWidgetTaskRow: View {
    let item: StrideWidgetTaskItem
    let pendingAction: StrideWidgetPendingAction?
    let payload: StrideTasksWidgetPayload
    let palette: StrideWidgetPalette
    let metrics: StrideWidgetMetrics
    let linksTaskDirectly: Bool

    var body: some View {
        HStack(alignment: .center, spacing: 7) {
            if !item.isUpcomingPreview {
                StrideWidgetTaskAction(
                    item: item,
                    pendingAction: pendingAction,
                    completeLabel: payload.resolvedCompleteLabel,
                    undoLabel: payload.resolvedUndoLabel,
                    color: item.priorityColor ?? palette.mutedText,
                    size: metrics.actionSize
                )
            }

            if item.isUpcomingPreview, !linksTaskDirectly,
               #available(iOSApplicationExtension 17.0, iOS 17.0, *) {
                Button(intent: StrideOpenWidgetTaskIntent(taskId: item.id)) {
                    rowText
                }
                .buttonStyle(.plain)
            } else if linksTaskDirectly {
                Link(destination: safeStrideURL(item.openUri ?? payload.focusUri)) {
                    rowText
                }
                .stridePendingAccessibilityValue(
                    pendingAction == nil ? nil : payload.resolvedCompleteLabel
                )
            } else {
                rowText
                    .stridePendingAccessibilityValue(
                        pendingAction == nil ? nil : payload.resolvedCompleteLabel
                    )
            }
        }
        .padding(.vertical, metrics.taskRowVPadding)
    }

    private var rowText: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(item.title)
                .font(.system(size: metrics.taskSize, weight: .medium))
                .foregroundColor(hexColor(palette.text))
                .strikethrough(pendingAction != nil)
                .lineLimit(1)
                .truncationMode(.tail)

            HStack(spacing: 4) {
                if let detailLabel = item.detailLabel {
                    if let identityColor = item.identityColor {
                        Circle()
                            .fill(hexColor(identityColor))
                            .frame(width: 5, height: 5)
                            .accessibilityHidden(true)
                    }
                    Text(detailLabel)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }

                Spacer(minLength: 2)

                if let dueLabel = nonEmpty(item.dueLabel) {
                    Text(dueLabel)
                        .foregroundColor(dueColor)
                        .lineLimit(1)
                        .layoutPriority(1)
                }
            }
            .font(.system(size: metrics.detailSize, weight: .medium))
            .foregroundColor(hexColor(palette.mutedText))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }

    private var dueColor: Color {
        switch item.dueTone {
        case "overdue":
            return hexColor(palette.warning ?? palette.accent)
        case "today":
            return hexColor(palette.accent)
        default:
            return hexColor(palette.mutedText)
        }
    }
}

private struct StrideWidgetTaskAction: View {
    let item: StrideWidgetTaskItem
    let pendingAction: StrideWidgetPendingAction?
    let completeLabel: String
    let undoLabel: String
    let color: String
    let size: CGFloat

    @ViewBuilder
    var body: some View {
        if let pendingAction, !pendingAction.claimed {
            if #available(iOSApplicationExtension 17.0, iOS 17.0, *) {
                Button(intent: StrideUndoWidgetTaskIntent(actionId: pendingAction.id)) {
                    marker(completed: true)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("\(undoLabel): \(item.title)"))
            } else {
                marker(completed: true)
                    .accessibilityHidden(true)
            }
        } else if pendingAction != nil {
            marker(completed: true)
                .accessibilityHidden(true)
        } else if let completionToken = nonEmpty(item.completionToken), !item.id.isEmpty {
            if #available(iOSApplicationExtension 17.0, iOS 17.0, *) {
                Button(intent: StrideCompleteWidgetTaskIntent(taskId: item.id, completionToken: completionToken)) {
                    marker(completed: false)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("\(completeLabel): \(item.title)"))
            } else {
                marker(completed: false)
                    .accessibilityHidden(true)
            }
        } else {
            marker(completed: false)
                .accessibilityHidden(true)
        }
    }

    private func marker(completed: Bool) -> some View {
        Image(systemName: completed ? "checkmark.circle.fill" : "circle")
            .font(.system(size: min(20, size * 0.68), weight: .semibold))
            .foregroundColor(hexColor(color))
            .frame(width: size, height: size)
            .contentShape(Rectangle())
    }
}

private extension View {
    @ViewBuilder
    func stridePendingAccessibilityValue(_ value: String?) -> some View {
        if let value {
            self.accessibilityValue(Text(value))
        } else {
            self
        }
    }

    @ViewBuilder
    func strideWidgetBackground(_ color: Color) -> some View {
        if #available(iOSApplicationExtension 17.0, iOS 17.0, *) {
            self.containerBackground(for: .widget) { color }
        } else {
            self.background(color)
        }
    }
}

func safeStrideURL(_ rawValue: String) -> URL {
    guard
        let url = URL(string: rawValue),
        url.scheme?.lowercased() == "stride"
    else {
        return URL(string: StrideTasksWidgetPayload.fallback.focusUri)!
    }
    return url
}

func hexColor(_ hex: String) -> Color {
    let cleaned = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
    var int: UInt64 = 0
    Scanner(string: cleaned).scanHexInt64(&int)

    let r: UInt64
    let g: UInt64
    let b: UInt64
    let a: UInt64

    switch cleaned.count {
    case 3:
        (r, g, b, a) = ((int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17, 255)
    case 4:
        (r, g, b, a) = ((int >> 12) * 17, (int >> 8 & 0xF) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
    case 6:
        (r, g, b, a) = (int >> 16, int >> 8 & 0xFF, int & 0xFF, 255)
    case 8:

        (r, g, b, a) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
    default:
        (r, g, b, a) = (15, 23, 42, 255)
    }

    return Color(
        .sRGB,
        red: Double(r) / 255,
        green: Double(g) / 255,
        blue: Double(b) / 255,
        opacity: Double(a) / 255
    )
}

@available(iOSApplicationExtension 17.0, iOS 17.0, *)
struct StrideTasksWidget: Widget {
    let kind: String = strideWidgetKind

    var body: some WidgetConfiguration {
        AppIntentConfiguration(
            kind: kind,
            intent: StrideTasksWidgetConfigurationIntent.self,
            provider: StrideTasksWidgetAppIntentProvider()
        ) { entry in
            StrideTasksWidgetView(entry: entry)
        }
        .configurationDisplayName("Stride")
        .description("Focus tasks and quick capture")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .systemExtraLarge])


        .contentMarginsDisabled()
    }
}

struct StrideLegacyTasksWidget: Widget {

    let kind: String = strideWidgetKind

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: StrideTasksWidgetProvider()) { entry in
            StrideTasksWidgetView(entry: entry)
        }
        .configurationDisplayName("Stride")
        .description("Focus tasks and quick capture")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .systemExtraLarge])
        .contentMarginsDisabled()
    }
}
