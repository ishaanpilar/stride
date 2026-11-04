import ExpoModulesCore
import Foundation

public final class StrideWatchConnectivityModule: Module {
    private var pendingCaptureObserver: NSObjectProtocol?

    public func definition() -> ModuleDefinition {
        Name("StrideWatchConnectivity")

        Events("onPendingCapture")

        OnCreate {
            self.pendingCaptureObserver = NotificationCenter.default.addObserver(
                forName: StrideWatchConnectivityReceiver.pendingCaptureNotification,
                object: nil,
                queue: .main
            ) { [weak self] _ in


                self?.sendEvent("onPendingCapture", [:])
            }
        }

        OnDestroy {
            if let observer = self.pendingCaptureObserver {
                NotificationCenter.default.removeObserver(observer)
                self.pendingCaptureObserver = nil
            }
        }

        Function("isWatchConnectivityAvailable") {
            StrideWatchConnectivityReceiver.shared.isAvailable
        }

        AsyncFunction("activateWatchConnectivity") { () async throws -> Void in
            try await StrideWatchConnectivityReceiver.shared.activate()
        }

        AsyncFunction("updateWatchApplicationContext") {
            (context: [String: Any]) async throws -> Void in
            try await StrideWatchConnectivityReceiver.shared.updateApplicationContext(context)
        }

        AsyncFunction("settleWatchChecklist") { (id: String, outcome: String) async throws -> Void in
            try await StrideWatchConnectivityReceiver.shared.settleChecklist(id: id, outcome: outcome)
        }
    }
}
