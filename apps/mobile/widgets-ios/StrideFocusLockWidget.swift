import SwiftUI
import WidgetKit

private let strideFocusLockWidgetKind = "StrideFocusLockWidget"


struct StrideFocusLockWidget: Widget {
    let kind: String = strideFocusLockWidgetKind

    private var families: [WidgetFamily] {
        if #available(iOSApplicationExtension 16.0, *) {
            return [.accessoryRectangular, .accessoryInline, .accessoryCircular]
        }
        return []
    }

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: StrideTasksWidgetProvider()) { entry in
            StrideFocusLockWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Focus")
        .description("Current focused task")
        .supportedFamilies(families)
    }
}

private struct StrideFocusLockWidgetEntryView: View {
    let entry: StrideTasksWidgetEntry

    var body: some View {
        if #available(iOSApplicationExtension 16.0, *) {
            StrideFocusLockView(entry: entry)
        } else {
            EmptyView()
        }
    }
}


@available(iOSApplicationExtension 16.0, *)
private struct StrideFocusLockView: View {
    let entry: StrideTasksWidgetEntry
    @Environment(\.widgetFamily) private var widgetFamily

    private var focusedTitle: String? {
        entry.payload.items.first?.title
    }

    var body: some View {
        content
            .widgetURL(URL(string: entry.payload.focusUri) ?? URL(fileURLWithPath: "/"))
            .strideLockWidgetBackground()
    }

    @ViewBuilder
    private var content: some View {
        switch widgetFamily {
        case .accessoryInline:
            Text(focusedTitle ?? entry.payload.emptyMessage)

        case .accessoryCircular:


            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 0) {
                    Image(systemName: "star.fill")
                        .font(.system(size: 11, weight: .semibold))
                    Text("\(entry.payload.focusedCount ?? entry.payload.items.count)")
                        .font(.system(size: 16, weight: .bold))
                }
            }

        default:


            VStack(alignment: .leading, spacing: 1) {
                Text(entry.payload.headerTitle)
                    .font(.system(size: 12, weight: .medium))
                    .opacity(0.75)
                    .lineLimit(1)
                if entry.payload.items.count > 1 {
                    ForEach(entry.payload.items.prefix(2), id: \.id) { item in
                        Text(item.title)
                            .font(.system(size: 14, weight: .semibold))
                            .lineLimit(1)
                    }
                } else {
                    Text(focusedTitle ?? entry.payload.emptyMessage)
                        .font(.system(size: 14, weight: .semibold))
                        .lineLimit(2)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        }
    }
}

private extension View {
    @ViewBuilder
    func strideLockWidgetBackground() -> some View {
        if #available(iOSApplicationExtension 17.0, *) {
            self.containerBackground(for: .widget) { Color.clear }
        } else {
            self
        }
    }
}
