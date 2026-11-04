import Dispatch
import Foundation
import XCTest
@testable import StrideSiriActionStore

private enum TestPublicationError: Error {
    case interrupted
}

private final class LockedErrors: @unchecked Sendable {
    private let lock = NSLock()
    private var errors: [Error] = []

    func append(_ error: Error) {
        lock.lock()
        errors.append(error)
        lock.unlock()
    }

    var count: Int {
        lock.lock()
        defer { lock.unlock() }
        return errors.count
    }
}

private final class LockedBooleans: @unchecked Sendable {
    private let lock = NSLock()
    private var values: [Bool] = []

    func append(_ value: Bool) {
        lock.lock()
        values.append(value)
        lock.unlock()
    }

    func snapshot() -> [Bool] {
        lock.lock()
        defer { lock.unlock() }
        return values
    }
}

final class StrideSiriActionStoreTests: XCTestCase {
    override func tearDown() {
        StrideSiriActionStore.endAccessSession()
        super.tearDown()
    }

    func testQueuedAccessEnableCannotOverrideResignOrDestroyGeneration() {
        let accessQueue = DispatchQueue(label: "stride-siri-access-resign-race")
        let resignDrained = expectation(description: "resign queue drained")
        let resignObservations = LockedBooleans()

        let activeGeneration = StrideSiriActionStore.beginAccessSession()
        accessQueue.suspend()
        accessQueue.async {
            StrideSiriActionStore.setAccessAllowed(true, forSession: activeGeneration)
            resignObservations.append(StrideSiriActionStore.isAccessAllowed)
        }


        StrideSiriActionStore.endAccessSession()
        accessQueue.async {
            resignDrained.fulfill()
        }
        accessQueue.resume()

        wait(for: [resignDrained], timeout: 5)
        XCTAssertEqual(resignObservations.snapshot(), [false])
        XCTAssertFalse(StrideSiriActionStore.isAccessAllowed)

        let nextGeneration = StrideSiriActionStore.beginAccessSession()
        StrideSiriActionStore.setAccessAllowed(true, forSession: activeGeneration)
        XCTAssertFalse(StrideSiriActionStore.isAccessAllowed)
        StrideSiriActionStore.setAccessAllowed(true, forSession: nextGeneration)
        XCTAssertTrue(StrideSiriActionStore.isAccessAllowed)

        let destroyQueue = DispatchQueue(label: "stride-siri-access-destroy-race")
        let destroyDrained = expectation(description: "destroy queue drained")
        let destroyObservations = LockedBooleans()
        destroyQueue.suspend()
        destroyQueue.async {
            StrideSiriActionStore.setAccessAllowed(true, forSession: nextGeneration)
            destroyObservations.append(StrideSiriActionStore.isAccessAllowed)
        }
        StrideSiriActionStore.endAccessSession()
        destroyQueue.async {
            destroyDrained.fulfill()
        }
        destroyQueue.resume()

        wait(for: [destroyDrained], timeout: 5)
        XCTAssertEqual(destroyObservations.snapshot(), [false])
        XCTAssertFalse(StrideSiriActionStore.isAccessAllowed)
    }

    func testEnqueueReplayIsIdempotentAndConflictingIdentifierIsRejected() throws {
        try withStore { store, _ in
            let now = Date(timeIntervalSince1970: 1_000)
            let request = makeRequest(index: 1, now: now)

            try store.enqueue(request, now: now)
            try store.enqueue(request, now: now.addingTimeInterval(200))
            XCTAssertEqual(try store.claimPending(now: now).map(\.id), [request.id])

            let conflict = StrideSiriActionRequest(
                id: request.id,
                operation: .create,
                createdAt: request.createdAt,
                expiresAt: request.expiresAt,
                fields: StrideSiriActionFields(title: "Different")
            )
            XCTAssertThrowsError(try store.enqueue(conflict, now: now)) { error in
                XCTAssertEqual(
                    error as? StrideSiriActionStoreError,
                    .conflictingRequestIdentifier
                )
            }
        }
    }

    func testPendingCapacityNeverEvictsExistingRequests() throws {
        try withStore { store, _ in
            let now = Date(timeIntervalSince1970: 2_000)
            for index in 0..<StrideSiriActionStore.maximumPendingActions {
                try store.enqueue(makeRequest(index: index, now: now), now: now)
            }

            XCTAssertThrowsError(
                try store.enqueue(makeRequest(index: 100, now: now), now: now)
            ) { error in
                XCTAssertEqual(error as? StrideSiriActionStoreError, .pendingCapacityFull)
            }
            XCTAssertEqual(
                try store.claimPending(now: now).count,
                StrideSiriActionStore.maximumPendingActions
            )
        }
    }

    func testClaimPersistsAcrossRestartIncludingAfterExpiry() throws {
        try withStore { store, directory in
            let now = Date(timeIntervalSince1970: 3_000)
            let request = makeRequest(index: 1, now: now, lifetimeSeconds: 10)
            try store.enqueue(request, now: now)
            XCTAssertEqual(try store.claimPending(now: now), [request])

            let reopened = StrideSiriActionStore(directory: directory)
            XCTAssertEqual(
                try reopened.claimPending(now: now.addingTimeInterval(30)),
                [request],
                "claimed work must remain visible until a durable result is acknowledged"
            )
        }
    }

    func testAcknowledgementRequiresAClaim() throws {
        try withStore { store, _ in
            let now = Date(timeIntervalSince1970: 4_000)
            let request = makeRequest(index: 1, now: now)
            try store.enqueue(request, now: now)

            XCTAssertThrowsError(
                try store.acknowledge(
                    id: request.id,
                    result: StrideSiriActionResult(outcome: .persisted, task: "{\"id\":\"task-1\"}"),
                    now: now
                )
            ) { error in
                XCTAssertEqual(
                    error as? StrideSiriActionStoreError,
                    .unclaimedAcknowledgement
                )
            }
            XCTAssertEqual(try store.claimPending(now: now), [request])
        }
    }

    func testFailedAcknowledgementPublicationLeavesClaimReplayable() throws {
        try withStore { store, directory in
            let now = Date(timeIntervalSince1970: 5_000)
            let request = makeRequest(index: 1, now: now)
            try store.enqueue(request, now: now)
            _ = try store.claimPending(now: now)

            let failing = StrideSiriActionStore(directory: directory) { fileName in
                if fileName == "stride-siri-actions-v1.json" {
                    throw TestPublicationError.interrupted
                }
            }
            XCTAssertThrowsError(
                try failing.acknowledge(
                    id: request.id,
                    result: StrideSiriActionResult(outcome: .persisted, task: "{\"id\":\"task-1\"}"),
                    now: now
                )
            )

            let reopened = StrideSiriActionStore(directory: directory)
            XCTAssertEqual(try reopened.claimPending(now: now), [request])
            XCTAssertNil(try reopened.result(id: request.id, now: now))
        }
    }

    func testExpiryAndCancellationBoundaryWriteDurableReceipts() throws {
        try withStore { store, _ in
            let now = Date(timeIntervalSince1970: 6_000)
            let beforeBoundary = makeRequest(index: 1, now: now, lifetimeSeconds: 10)
            let atBoundary = makeRequest(index: 2, now: now, lifetimeSeconds: 10)
            try store.enqueue(beforeBoundary, now: now)
            try store.enqueue(atBoundary, now: now)

            XCTAssertTrue(try store.cancelUnclaimed(
                id: beforeBoundary.id,
                now: now.addingTimeInterval(9.999)
            ))
            XCTAssertEqual(
                try store.result(id: beforeBoundary.id, now: now),
                StrideSiriActionResult(outcome: .rejected, reason: .cancelled)
            )

            XCTAssertFalse(try store.cancelUnclaimed(
                id: atBoundary.id,
                now: now.addingTimeInterval(10)
            ))
            XCTAssertEqual(
                try store.result(id: atBoundary.id, now: now.addingTimeInterval(10)),
                StrideSiriActionResult(outcome: .rejected, reason: .expired)
            )
        }
    }

    func testExpiredUnclaimedBecomesReceiptButClaimedCannotBeCancelled() throws {
        try withStore { store, _ in
            let now = Date(timeIntervalSince1970: 7_000)
            let expired = makeRequest(index: 1, now: now, lifetimeSeconds: 1)
            let claimed = makeRequest(index: 2, now: now, lifetimeSeconds: 10)
            try store.enqueue(expired, now: now)
            try store.enqueue(claimed, now: now)

            XCTAssertEqual(
                try store.claimPending(now: now.addingTimeInterval(2)).map(\.id),
                [claimed.id]
            )
            XCTAssertFalse(try store.cancelUnclaimed(id: claimed.id, now: now))
            XCTAssertEqual(try store.claimPending(now: now.addingTimeInterval(20)), [claimed])

            XCTAssertEqual(
                try store.result(id: expired.id, now: now.addingTimeInterval(2)),
                StrideSiriActionResult(outcome: .rejected, reason: .expired)
            )
        }
    }

    func testReceiptSurvivesRestartAndPreventsReplayUntilRetentionPurge() throws {
        try withStore { store, directory in
            let now = Date(timeIntervalSince1970: 8_000)
            let request = makeRequest(index: 1, now: now)
            try store.enqueue(request, now: now)
            _ = try store.claimPending(now: now)
            let result = StrideSiriActionResult(
                outcome: .persisted,
                task: "{\"id\":\"task-1\",\"title\":\"Saved\"}"
            )
            try store.acknowledge(id: request.id, result: result, now: now)

            let reopened = StrideSiriActionStore(directory: directory)
            XCTAssertEqual(try reopened.result(id: request.id, now: now), result)
            try reopened.enqueue(request, now: now.addingTimeInterval(200))
            XCTAssertTrue(try reopened.claimPending(now: now).isEmpty)

            let afterRetention = now.addingTimeInterval(24 * 60 * 60 + 1)
            XCTAssertNil(try reopened.result(id: request.id, now: afterRetention))
            XCTAssertThrowsError(try reopened.enqueue(request, now: afterRetention)) { error in
                XCTAssertEqual(error as? StrideSiriActionStoreError, .expiredRequest)
            }
        }
    }

    func testMalformedOversizedAndUnknownRequestFieldsFailClosed() throws {
        try withStore { store, directory in
            let now = Date(timeIntervalSince1970: 9_000)
            let oversized = StrideSiriActionRequest(
                id: uuid(1),
                operation: .create,
                createdAt: milliseconds(now),
                expiresAt: milliseconds(now) + 120_000,
                fields: StrideSiriActionFields(description: String(repeating: "x", count: 32_001))
            )
            XCTAssertThrowsError(try store.enqueue(oversized, now: now))

            let stateURL = directory.appendingPathComponent("stride-siri-actions-v1.json")
            let unknown = Data("""
            {
              "version": 1,
              "pending": [{
                "request": {
                  "version": 1,
                  "id": "\(uuid(2))",
                  "operation": "create",
                  "createdAt": 9000000,
                  "expiresAt": 9120000,
                  "fields": {"title": "private", "invented": true},
                  "clearFields": [],
                  "unknownCommand": "must not be dropped"
                },
                "claimed": false
              }],
              "receipts": []
            }
            """.utf8)
            try unknown.write(to: stateURL)

            XCTAssertThrowsError(try store.claimPending(now: now)) { error in
                guard let storeError = error as? StrideSiriActionStoreError else {
                    return XCTFail("expected corrupt state, got \(error)")
                }
                guard case .corruptState = storeError else {
                    return XCTFail("expected corrupt state, got \(error)")
                }
            }
            XCTAssertEqual(try Data(contentsOf: stateURL), unknown)

            let malformed = Data("{not-json".utf8)
            try malformed.write(to: stateURL)
            XCTAssertThrowsError(try store.claimPending(now: now))
            XCTAssertEqual(try Data(contentsOf: stateURL), malformed)
        }
    }

    func testCommandWideSizeLimitCatchesEscapingExpansion() throws {
        try withStore { store, _ in
            let now = Date(timeIntervalSince1970: 9_500)
            let request = StrideSiriActionRequest(
                id: uuid(1),
                operation: .create,
                createdAt: milliseconds(now),
                expiresAt: milliseconds(now) + 120_000,
                fields: StrideSiriActionFields(
                    title: String(repeating: "\n", count: 2_000),
                    description: String(repeating: "\n", count: 32_000),
                    dueDate: String(repeating: "\n", count: 4_096),
                    tags: Array(repeating: String(repeating: "\n", count: 100), count: 32)
                )
            )
            XCTAssertThrowsError(try store.enqueue(request, now: now)) { error in
                XCTAssertEqual(
                    error as? StrideSiriActionStoreError,
                    .invalidRequest("command size")
                )
            }
        }
    }

    func testOperationAndResultValidation() throws {
        try withStore { store, _ in
            let now = Date(timeIntervalSince1970: 10_000)
            let deleteWithFields = StrideSiriActionRequest(
                id: uuid(1),
                operation: .delete,
                targetId: uuid(2),
                expectedToken: "revision-1",
                createdAt: milliseconds(now),
                expiresAt: milliseconds(now) + 120_000,
                fields: StrideSiriActionFields(isCompleted: true)
            )
            XCTAssertThrowsError(try store.enqueue(deleteWithFields, now: now))

            XCTAssertThrowsError(try StrideSiriActionStore.decodeResultJSON(
                "{\"outcome\":\"rejected\",\"task\":\"{}\"}"
            ))
            XCTAssertThrowsError(try StrideSiriActionStore.decodeResultJSON(
                "{\"outcome\":\"persisted\",\"unknown\":true}"
            ))
            XCTAssertNoThrow(try StrideSiriActionStore.decodeResultJSON(
                "{\"outcome\":\"rejected\",\"reason\":\"stale\"}"
            ))
        }
    }

    func testSnapshotPublicationIsBoundedAtomicAndObjectOnly() throws {
        try withStore { store, directory in
            let oldSnapshot = "{\"requiresAppUnlock\":true,\"tasks\":[]}"
            try store.publishSnapshot(oldSnapshot)
            XCTAssertEqual(try store.readSnapshotFile(), oldSnapshot)

            let failing = StrideSiriActionStore(directory: directory) { fileName in
                if fileName == "stride-siri-snapshot-v1.json" {
                    throw TestPublicationError.interrupted
                }
            }
            XCTAssertThrowsError(try failing.publishSnapshot(
                "{\"requiresAppUnlock\":false,\"tasks\":[]}"
            ))
            XCTAssertEqual(try store.readSnapshotFile(), oldSnapshot)

            XCTAssertThrowsError(try store.publishSnapshot("[]")) { error in
                XCTAssertEqual(error as? StrideSiriActionStoreError, .invalidSnapshot)
            }
            XCTAssertThrowsError(try store.publishSnapshot(
                "{\"value\":\"\(String(repeating: "x", count: StrideSiriActionStore.maximumSnapshotBytes))\"}"
            )) { error in
                XCTAssertEqual(error as? StrideSiriActionStoreError, .snapshotTooLarge)
            }
        }
    }

    func testSimultaneousStoreInstancesSerializeWithoutLostRequests() throws {
        try withStore { firstStore, directory in
            let secondStore = StrideSiriActionStore(directory: directory)
            let queue = DispatchQueue(
                label: "stride-siri-actions-concurrency",
                attributes: .concurrent
            )
            let group = DispatchGroup()
            let errors = LockedErrors()
            let now = Date(timeIntervalSince1970: 11_000)
            let requests = (0..<StrideSiriActionStore.maximumPendingActions).map {
                makeRequest(index: $0, now: now)
            }

            for index in 0..<StrideSiriActionStore.maximumPendingActions {
                group.enter()
                queue.async {
                    defer { group.leave() }
                    do {
                        let store = index.isMultiple(of: 2) ? firstStore : secondStore
                        try store.enqueue(requests[index], now: now)
                    } catch {
                        errors.append(error)
                    }
                }
            }

            XCTAssertEqual(group.wait(timeout: .now() + 10), .success)
            XCTAssertEqual(errors.count, 0)
            XCTAssertEqual(
                try firstStore.claimPending(now: now).count,
                StrideSiriActionStore.maximumPendingActions
            )
        }
    }

    func testErrorsNeverIncludeCommandContent() throws {
        try withStore { store, _ in
            let now = Date(timeIntervalSince1970: 12_000)
            let privateContent = "do not disclose this task title"
            let request = StrideSiriActionRequest(
                id: uuid(1),
                operation: .create,
                targetId: uuid(2),
                createdAt: milliseconds(now),
                expiresAt: milliseconds(now) + 120_000,
                fields: StrideSiriActionFields(title: privateContent)
            )

            XCTAssertThrowsError(try store.enqueue(request, now: now)) { error in
                XCTAssertFalse(error.localizedDescription.contains(privateContent))
            }
        }
    }

    private func withStore(
        _ body: (StrideSiriActionStore, URL) throws -> Void
    ) throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(
            "stride-siri-action-\(UUID().uuidString)",
            isDirectory: true
        )
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: directory) }
        try body(StrideSiriActionStore(directory: directory), directory)
    }

    private func makeRequest(
        index: Int,
        now: Date,
        lifetimeSeconds: TimeInterval = 120
    ) -> StrideSiriActionRequest {
        StrideSiriActionRequest(
            id: uuid(index),
            operation: .create,
            createdAt: milliseconds(now),
            expiresAt: milliseconds(now.addingTimeInterval(lifetimeSeconds)),
            fields: StrideSiriActionFields(title: "Task \(index)")
        )
    }

    private func uuid(_ index: Int) -> String {
        String(format: "00000000-0000-4000-8000-%012d", index)
    }

    private func milliseconds(_ date: Date) -> Double {
        date.timeIntervalSince1970 * 1_000
    }
}
