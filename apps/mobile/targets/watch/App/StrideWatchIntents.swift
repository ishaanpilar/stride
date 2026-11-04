import AppIntents
import Foundation

extension Notification.Name {
    static let strideWatchOpenCapture = Notification.Name("com.ishaanpilar.stride.watch.open-capture")
}

@available(watchOS 10.0, *)
struct StrideOpenWatchCaptureIntent: AppIntent {
    static var title: LocalizedStringResource = "Capture in Stride"
    static var description = IntentDescription("Opens Stride for dictation or audio capture.")

    #if compiler(>=6.0)
    @available(watchOS 26.0, *)
    static var supportedModes: IntentModes {
        .foreground(.immediate)
    }
    #endif

    @available(*, deprecated, message: "Use supportedModes with newer App Intents SDKs.")
    static var openAppWhenRun: Bool { true }

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        StrideWatchSnapshotStore.requestCaptureOnNextOpen()
        NotificationCenter.default.post(name: .strideWatchOpenCapture, object: nil)
        return .result(dialog: "Stride is ready to capture.")
    }
}

@available(watchOS 10.0, *)
struct StrideStartWatchPomodoroIntent: AppIntent {
    static var title: LocalizedStringResource = "Start Stride Focus Timer"
    static var description = IntentDescription("Starts the current Stride Pomodoro timer.")

    #if compiler(>=6.0)
    @available(watchOS 26.0, *)
    static var supportedModes: IntentModes {
        .background
    }
    #endif

    @available(*, deprecated, message: "Use supportedModes with newer App Intents SDKs.")
    static var openAppWhenRun: Bool { false }

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        StrideWatchConnectivityModel.shared.sendPomodoro(
            action: .start,
            taskId: StrideWatchConnectivityModel.shared.snapshot.pomodoro.taskId
        )
        return .result(dialog: "Starting the Stride focus timer.")
    }
}

@available(watchOS 10.0, *)
struct StrideWatchShortcuts: AppShortcutsProvider {
    @AppShortcutsBuilder
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: StrideOpenWatchCaptureIntent(),
            phrases: [
                "Capture in \(.applicationName)",
                "Open \(.applicationName) capture",
            ],
            shortTitle: "Capture",
            systemImageName: "mic.fill"
        )
        AppShortcut(
            intent: StrideStartWatchPomodoroIntent(),
            phrases: [
                "Start a focus timer in \(.applicationName)",
                "Start \(.applicationName) focus",
            ],
            shortTitle: "Start Focus Timer",
            systemImageName: "timer"
        )
    }
}
