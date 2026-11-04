import SwiftUI
import WidgetKit

private struct StrideWatchWidgetEntry: TimelineEntry {
    let date: Date
    let snapshot: StrideWatchSnapshot
}

private struct StrideWatchWidgetProvider: TimelineProvider {
    func placeholder(in context: Context) -> StrideWatchWidgetEntry {
        StrideWatchWidgetEntry(date: .now, snapshot: .empty)
    }

    func getSnapshot(in context: Context, completion: @escaping (StrideWatchWidgetEntry) -> Void) {
        completion(StrideWatchWidgetEntry(date: .now, snapshot: StrideWatchSnapshotStore.load()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<StrideWatchWidgetEntry>) -> Void) {
        let snapshot = StrideWatchSnapshotStore.load()
        var entries = [StrideWatchWidgetEntry(date: .now, snapshot: snapshot)]
        if snapshot.pomodoro.isRunning,
           let milliseconds = snapshot.pomodoro.phaseEndTime {
            let end = Date(timeIntervalSince1970: milliseconds / 1_000)
            if end > .now { entries.append(StrideWatchWidgetEntry(date: end, snapshot: snapshot)) }
        }
        completion(Timeline(entries: entries, policy: .after(Date().addingTimeInterval(15 * 60))))
    }
}

private struct StrideWatchWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: StrideWatchWidgetEntry

    var body: some View {
        switch family {
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                Image(systemName: entry.snapshot.pomodoro.isRunning ? "timer" : "drop.fill")
                    .font(.title3)
            }
            .widgetURL(destination)
        case .accessoryInline:
            Label(inlineTitle, systemImage: entry.snapshot.pomodoro.isRunning ? "timer" : "drop.fill")
                .privacySensitive()
                .widgetURL(destination)
        default:
            VStack(alignment: .leading, spacing: 3) {
                Label(entry.snapshot.pomodoro.phase == .focus ? "Focus" : "Break", systemImage: "timer")
                    .font(.headline)
                if entry.snapshot.pomodoro.isRunning,
                   let milliseconds = entry.snapshot.pomodoro.phaseEndTime,
                   milliseconds > Date().timeIntervalSince1970 * 1_000 {
                    Text(timerInterval: Date()...Date(timeIntervalSince1970: milliseconds / 1_000), countsDown: true)
                        .font(.title3.monospacedDigit())
                } else if let task = entry.snapshot.focus.first {
                    Text(task.title)
                        .lineLimit(2)
                        .privacySensitive()
                } else {
                    Text("Ready to capture")
                }
            }
            .widgetURL(destination)
        }
    }

    private var inlineTitle: String {
        if entry.snapshot.pomodoro.isRunning {
            return entry.snapshot.pomodoro.phase == .focus ? "Focus timer" : "Break timer"
        }
        return entry.snapshot.focus.first?.title ?? "Capture"
    }

    private var destination: URL? {
        URL(string: entry.snapshot.pomodoro.isRunning ? "stride-watch://pomodoro" : "stride-watch://capture")
    }
}

private struct StrideWatchWidget: Widget {
    let kind = "StrideWatchWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: StrideWatchWidgetProvider()) { entry in
            StrideWatchWidgetView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Stride Focus")
        .description("See your current Focus timer or next Focus task.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

@main
struct StrideWatchWidgetBundle: WidgetBundle {
    var body: some Widget {
        StrideWatchWidget()
    }
}
