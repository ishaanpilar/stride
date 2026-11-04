import ExpoModulesCore
import Foundation
import UIKit

public final class StrideIosSiriActionsModule: Module {
    private static let ioQueue = DispatchQueue(
        label: "com.ishaanpilar.stride.iosSiriActions.io",
        qos: .userInitiated
    )
    private var pendingObserver: NSObjectProtocol?
    private var resignObserver: NSObjectProtocol?
    private var becomeActiveObserver: NSObjectProtocol?
    private var accessSessionGeneration: UInt64?

    public func definition() -> ModuleDefinition {
        Name("StrideIosSiriActions")

        Events("onPendingActionsChanged")

        OnCreate {
            Self.performOnMain {
                self.resignObserver = NotificationCenter.default.addObserver(
                    forName: UIApplication.willResignActiveNotification,
                    object: nil,
                    queue: .main
                ) { [weak self] _ in
                    StrideSiriActionStore.endAccessSession()
                    self?.accessSessionGeneration = nil
                }
                self.becomeActiveObserver = NotificationCenter.default.addObserver(
                    forName: UIApplication.didBecomeActiveNotification,
                    object: nil,
                    queue: .main
                ) { [weak self] _ in
                    guard UIApplication.shared.applicationState == .active else {
                        StrideSiriActionStore.endAccessSession()
                        self?.accessSessionGeneration = nil
                        return
                    }
                    self?.accessSessionGeneration = StrideSiriActionStore.beginAccessSession()
                }
                if UIApplication.shared.applicationState == .active {
                    self.accessSessionGeneration = StrideSiriActionStore.beginAccessSession()
                } else {
                    StrideSiriActionStore.endAccessSession()
                    self.accessSessionGeneration = nil
                }
            }
            self.pendingObserver = NotificationCenter.default.addObserver(
                forName: StrideSiriActionStore.pendingActionsChangedNotification,
                object: nil,
                queue: .main
            ) { [weak self] _ in
                self?.sendEvent("onPendingActionsChanged", [:])
            }
        }

        OnDestroy {
            Self.performOnMain {
                StrideSiriActionStore.endAccessSession()
                self.accessSessionGeneration = nil
                if let observer = self.resignObserver {
                    NotificationCenter.default.removeObserver(observer)
                    self.resignObserver = nil
                }
                if let observer = self.becomeActiveObserver {
                    NotificationCenter.default.removeObserver(observer)
                    self.becomeActiveObserver = nil
                }
            }
            if let observer = self.pendingObserver {
                NotificationCenter.default.removeObserver(observer)
                self.pendingObserver = nil
            }
        }

        AsyncFunction("claimPending") { () throws -> [[String: Any]] in
            let requests = try StrideSiriActionStore.appGroupStore().claimPending(now: Date())
            return try requests.map { try Self.dictionary(from: $0) }
        }.runOnQueue(Self.ioQueue)

        AsyncFunction("acknowledge") { (id: String, resultJSON: String) throws -> Void in
            let result = try StrideSiriActionStore.decodeResultJSON(resultJSON)
            try StrideSiriActionStore.appGroupStore().acknowledge(
                id: id,
                result: result,
                now: Date()
            )
        }.runOnQueue(Self.ioQueue)

        AsyncFunction("publishSnapshot") { (snapshotJSON: String) throws -> Void in
            try StrideSiriActionStore.appGroupStore().publishSnapshot(snapshotJSON)
        }.runOnQueue(Self.ioQueue)

        AsyncFunction("setAccessAllowed") { (allowed: Bool) -> Void in
            guard UIApplication.shared.applicationState == .active,
                  let generation = self.accessSessionGeneration else {
                StrideSiriActionStore.endAccessSession()
                self.accessSessionGeneration = nil
                return
            }
            StrideSiriActionStore.setAccessAllowed(allowed, forSession: generation)
        }.runOnQueue(.main)
    }

    private static func dictionary(
        from request: StrideSiriActionRequest
    ) throws -> [String: Any] {
        let encoder = JSONEncoder()
        let data = try encoder.encode(request)
        guard let dictionary = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw StrideSiriActionStoreError.corruptState("could not bridge a request")
        }
        return dictionary
    }

    private static func performOnMain(_ body: () -> Void) {
        if Thread.isMainThread {
            body()
            return
        }
        DispatchQueue.main.sync(execute: body)
    }
}
