import Foundation
import UserNotifications
import WatchConnectivity
import WatchKit
import WidgetKit

@MainActor
final class StrideWatchConnectivityModel: NSObject, ObservableObject {
    static let shared = StrideWatchConnectivityModel()

    @Published private(set) var snapshot = StrideWatchSnapshotStore.load()
    @Published private(set) var statusMessage: String?
    @Published private(set) var isReachable = false
    @Published var rejectedCaptureDraft: String?
    @Published private(set) var checklistRevision = 0

    private let session: WCSession?
    private var inFlightCommandIds = Set<String>()
    private var lastHapticEndTime: TimeInterval?
    private var pendingTextCapture = StrideWatchPendingCaptureOwner()

    override private init() {
        session = WCSession.isSupported() ? .default : nil
        super.init()
    }

    func activate() {
        guard let session else {
            statusMessage = String(localized: "Connect to your iPhone to continue.")
            return
        }
        session.delegate = self
        if session.activationState == .activated {
            flushOutbox()
        } else {
            session.activate()
        }
    }

    func replayPendingOutbox() {
        flushOutbox()
    }

    func capture(text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        guard trimmed.count <= StrideWatchProtocol.maximumCaptureCharacters,
              trimmed.lengthOfBytes(using: .utf8) <= StrideWatchProtocol.maximumCaptureUtf8Bytes
        else {
            rejectedCaptureDraft = text
            statusMessage = String(localized: "Please shorten this capture before sending.")
            return
        }
        var pendingOwner = pendingTextCapture
        let pending = pendingOwner.prepareText(trimmed)
        guard let payload = StrideWatchProtocol.textCapture(
            title: trimmed,
            id: pending.id,
            createdAt: pending.createdAt,
            outboxRetried: pending.outboxRetried
        ) else { return }
        let saved = pendingOwner.persistPending { _ in
            enqueue(payload: payload, transport: .userInfo)
        }
        pendingTextCapture = pendingOwner
        rejectedCaptureDraft = saved ? nil : text
    }

    func complete(task: StrideWatchFocusTask) {
        enqueue(payload: StrideWatchProtocol.command(kind: .complete, taskId: task.id), transport: .command)
    }

    func displayedTask(_ task: StrideWatchFocusTask) -> StrideWatchFocusTask {
        let current = snapshot.focus.first(where: { $0.id == task.id }) ?? task
        return StrideWatchProtocol.overlay(StrideWatchOutbox.records().map(\.payload), on: current)
    }

    func setChecklist(task: StrideWatchFocusTask, item: StrideWatchChecklistItem, completed: Bool) {

        let latest = StrideWatchOutbox.records().compactMap { StrideWatchProtocol.timestamp($0.createdAt) }.max() ?? 0
        let date = Date(timeIntervalSince1970: max(Date().timeIntervalSince1970, latest + 0.002))
        guard let payload = StrideWatchProtocol.checklistCommand(task: task, item: item, completed: completed, createdAt: date) else {
            statusMessage = String(localized: "This checklist changed. Open Stride on your iPhone.")
            return
        }
        if enqueue(payload: payload, transport: .command) { checklistRevision += 1 }
    }

    func deferUntilTomorrow(task: StrideWatchFocusTask) {
        enqueue(payload: StrideWatchProtocol.command(
            kind: .deferTask,
            taskId: task.id,
            startDate: StrideWatchProtocol.tomorrowDate()
        ), transport: .command)
    }

    func sendPomodoro(action: StrideWatchProtocol.PomodoroAction, taskId: String? = nil) {
        if action == .start {
            StridePomodoroEndScheduler.requestAuthorizationAfterExplicitStart()
        }
        enqueue(
            payload: StrideWatchProtocol.command(kind: .pomodoro, taskId: taskId, action: action),
            transport: .command
        )
    }

    @discardableResult
    func transferAudio(
        fileURL: URL,
        id: UUID,
        createdAt: Date,
        outboxRetried: Bool = false
    ) -> Bool {
        enqueue(
            payload: StrideWatchProtocol.audioMetadata(
                id: id,
                createdAt: createdAt,
                outboxRetried: outboxRetried
            ),
            transport: .audio,
            audioURL: fileURL
        )
    }

    func handleTimerTick(at date: Date) {
        let pomodoro = snapshot.pomodoro
        guard pomodoro.completionAlert,
              pomodoro.isRunning,
              pomodoro.remaining(at: date) == 0,
              let phaseEndTime = pomodoro.phaseEndTime,
              lastHapticEndTime != phaseEndTime
        else { return }
        lastHapticEndTime = phaseEndTime
        WKInterfaceDevice.current().play(.notification)
    }

    @discardableResult
    private func enqueue(
        payload: [String: Any],
        transport: StrideWatchOutbox.Transport,
        audioURL: URL? = nil
    ) -> Bool {
        do {
            try StrideWatchOutbox.save(payload: payload, transport: transport, audioURL: audioURL)
            statusMessage = transport == .audio
                ? String(localized: "Recording saved for delivery")
                : String(localized: "Saved for delivery")
            activate()
            return true
        } catch {
            statusMessage = String(localized: "Couldn’t save this item. Please try again.")
            return false
        }
    }

    private func flushOutbox() {
        guard let session, session.activationState == .activated else { return }
        isReachable = session.isReachable
        let outstandingUserInfoIds = Set(session.outstandingUserInfoTransfers.compactMap {
            $0.userInfo["id"] as? String
        })
        let outstandingAudioIds = Set(session.outstandingFileTransfers.compactMap {
            $0.file.metadata?["id"] as? String
        })

        for record in StrideWatchOutbox.records() {
            if record.settledAt != nil { continue }
            switch record.transport {
            case .userInfo:
                if !outstandingUserInfoIds.contains(record.id) {
                    session.transferUserInfo(record.payload)
                }
            case .command:
                sendPersistedCommand(record, using: session, outstandingUserInfoIds: outstandingUserInfoIds)
            case .audio:
                guard !outstandingAudioIds.contains(record.id),
                      let audioURL = record.audioURL,
                      FileManager.default.fileExists(atPath: audioURL.path)
                else { continue }
                session.transferFile(audioURL, metadata: record.payload)
            }
        }
    }

    private func sendPersistedCommand(
        _ record: StrideWatchOutbox.Record,
        using session: WCSession,
        outstandingUserInfoIds: Set<String>
    ) {
        guard !inFlightCommandIds.contains(record.id) else { return }
        guard session.isReachable else {
            if !outstandingUserInfoIds.contains(record.id) {
                session.transferUserInfo(record.payload)
            }
            return
        }

        inFlightCommandIds.insert(record.id)
        session.sendMessage(record.payload) { [weak self] reply in
            Task { @MainActor in
                guard let self else { return }
                self.inFlightCommandIds.remove(record.id)
                if reply["accepted"] as? Bool == true {

                    if record.payload["kind"] as? String != "checklist" {
                        StrideWatchOutbox.remove(id: record.id, removeAudio: false)
                    }
                    self.statusMessage = String(localized: "Sent")
                } else {
                    self.queuePersistedCommandFallback(record)
                }
            }
        } errorHandler: { [weak self] _ in
            Task { @MainActor in
                self?.inFlightCommandIds.remove(record.id)
                self?.queuePersistedCommandFallback(record)
            }
        }
    }

    private func queuePersistedCommandFallback(_ record: StrideWatchOutbox.Record) {
        guard let session, session.activationState == .activated else { return }
        let alreadyQueued = session.outstandingUserInfoTransfers.contains {
            $0.userInfo["id"] as? String == record.id
        }
        if !alreadyQueued { session.transferUserInfo(record.payload) }
        statusMessage = String(localized: "Saved for delivery")
    }

    private func accept(applicationContext: [String: Any]) {
        guard let updated = StrideWatchSnapshot(applicationContext: applicationContext) else { return }
        if let incoming = StrideWatchProtocol.timestamp(updated.generatedAt),
           let current = StrideWatchProtocol.timestamp(snapshot.generatedAt), incoming < current { return }
        snapshot = updated
        clearSettledChecklistCommands()
        WidgetCenter.shared.reloadAllTimelines()
        StridePomodoroEndScheduler.reconcile(with: updated.pomodoro)
    }

    private func clearSettledChecklistCommands() {
        guard StrideWatchSnapshotStore.save(snapshot) else { return }
        guard let generatedAt = StrideWatchProtocol.timestamp(snapshot.generatedAt) else { return }
        for record in StrideWatchOutbox.records() {
            if let settledAt = record.settledAt, generatedAt >= settledAt {
                StrideWatchOutbox.remove(id: record.id, removeAudio: false)
            }
        }
        checklistRevision += 1
    }

    private func accept(receipt: [String: Any]) {
        guard (receipt["protocolVersion"] as? NSNumber)?.intValue == StrideWatchProtocol.version,
              receipt["kind"] as? String == "receipt",
              receipt["accepted"] as? Bool == true,
              let rawId = receipt["id"] as? String,
              let uuid = UUID(uuidString: rawId)
        else { return }
        let id = uuid.uuidString.lowercased()
        if let record = StrideWatchOutbox.records().first(where: { $0.id == id }),
           record.payload["kind"] as? String == "checklist" {
            guard let outcome = receipt["outcome"] as? String else { return }
            if outcome == "applied", let settledAt = receipt["settledAt"] as? Double {
                do {
                    try StrideWatchOutbox.save(payload: record.payload, transport: record.transport, settledAt: settledAt)
                    clearSettledChecklistCommands()
                } catch {
                    statusMessage = String(localized: "Couldn’t save this item. Please try again.")
                    return
                }
            } else if ["stale", "missing", "terminal", "changed"].contains(outcome) {
                StrideWatchOutbox.remove(id: id, removeAudio: false)
                checklistRevision += 1
                statusMessage = String(localized: "This checklist changed. Open Stride on your iPhone.")
                return
            } else { return }
            statusMessage = String(localized: "Saved on iPhone")
            return
        }
        let removeAudio = StrideWatchOutbox.records().contains { $0.id == id && $0.transport == .audio }
        StrideWatchOutbox.remove(id: id, removeAudio: removeAudio)
        statusMessage = String(localized: "Delivered")
    }
}

extension StrideWatchConnectivityModel: WCSessionDelegate {
    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        Task { @MainActor [weak self] in self?.accept(receipt: message) }
    }
    nonisolated func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        Task { @MainActor [weak self] in
            guard let self else { return }
            self.isReachable = activationState == .activated && session.isReachable
            if let error {
                self.statusMessage = error.localizedDescription
                return
            }
            guard activationState == .activated else { return }
            if !session.receivedApplicationContext.isEmpty {
                self.accept(applicationContext: session.receivedApplicationContext)
            }
            self.flushOutbox()
        }
    }

    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        Task { @MainActor [weak self] in
            guard let self else { return }
            self.isReachable = session.activationState == .activated && session.isReachable
            self.flushOutbox()
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        Task { @MainActor [weak self] in self?.accept(applicationContext: applicationContext) }
    }

    nonisolated func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        Task { @MainActor [weak self] in self?.accept(receipt: userInfo) }
    }

    nonisolated func session(_ session: WCSession, didFinish fileTransfer: WCSessionFileTransfer, error: Error?) {
        let id = (fileTransfer.file.metadata?["id"] as? String)
            .flatMap(UUID.init(uuidString:))?
            .uuidString
            .lowercased()
        Task { @MainActor [weak self] in
            guard let self else { return }
            if error != nil {
                self.statusMessage = String(localized: "Recording saved. It will retry when the connection changes.")
            } else if let id, StrideWatchOutbox.records().contains(where: { $0.id == id }) {
                self.statusMessage = String(localized: "Recording is waiting for iPhone confirmation.")
            }
        }
    }
}

private enum StridePomodoroEndScheduler {
    private static let notificationIdentifier = "stride.watch.pomodoro.end"
    private static let queue = DispatchQueue(label: "com.ishaanpilar.stride.watch-pomodoro-notification")
    private static var revision = 0

    static func requestAuthorizationAfterExplicitStart() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { accepted, _ in
            guard accepted else { return }
            Task { @MainActor in
                reconcile(with: StrideWatchConnectivityModel.shared.snapshot.pomodoro)
            }
        }
    }

    static func reconcile(with pomodoro: StrideWatchPomodoro) {
        queue.async {
            revision += 1
            let scheduledRevision = revision
            let center = UNUserNotificationCenter.current()
            center.removePendingNotificationRequests(withIdentifiers: [notificationIdentifier])
            guard pomodoro.completionAlert,
                  pomodoro.isRunning,
                  let phaseEndTime = pomodoro.phaseEndTime,
                  phaseEndTime > Date().timeIntervalSince1970 * 1_000
            else { return }

            center.getNotificationSettings { settings in
                queue.async {
                    guard scheduledRevision == revision,
                          settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional
                    else { return }
                    let content = UNMutableNotificationContent()
                    content.title = String(localized: "Stride timer finished")
                    content.body = pomodoro.phase == .focus
                        ? String(localized: "Time for a break.")
                        : String(localized: "Ready to focus?")
                    content.sound = .default
                    let interval = max(1, phaseEndTime / 1_000 - Date().timeIntervalSince1970)
                    let request = UNNotificationRequest(
                        identifier: notificationIdentifier,
                        content: content,
                        trigger: UNTimeIntervalNotificationTrigger(timeInterval: interval, repeats: false)
                    )
                    center.add(request)
                }
            }
        }
    }
}
