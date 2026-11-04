import Dispatch
import Foundation
import XCTest
@testable import StrideWidgetActionStore

private final class LockedErrors: @unchecked Sendable {
    private let lock = NSLock()
    private var values: [Error] = []

    func append(_ error: Error) {
        lock.lock()
        values.append(error)
        lock.unlock()
    }

    var count: Int {
        lock.lock()
        defer { lock.unlock() }
        return values.count
    }
}

private final class LockedValue<Value>: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Value?

    func store(_ next: Value) {
        lock.lock()
        value = next
        lock.unlock()
    }

    func load() -> Value? {
        lock.lock()
        defer { lock.unlock() }
        return value
    }
}

final class StrideWidgetActionStoreTests: XCTestCase {
    func testEnqueueUsesThreeSecondBoundaryAndCancelOnlyWorksBeforeClaim() throws {
        try withStore { store, _ in
            let start = Date(timeIntervalSince1970: 1_000)
            try store.enqueue(taskId: "task-1", token: "revision-1", now: start)

            let pending = try XCTUnwrap(store.pendingActions().first)
            XCTAssertEqual(pending.createdAt, 1_000_000)
            XCTAssertEqual(pending.notBefore, 1_003_000)
            XCTAssertFalse(pending.claimed)
            XCTAssertEqual(try store.nextReadyAt(), 1_003_000)
            XCTAssertTrue(try store.claimReady(
                now: Date(timeIntervalSince1970: 1_002.999)
            ).isEmpty)

            let claimed = try store.claimReady(now: Date(timeIntervalSince1970: 1_003))
            XCTAssertEqual(claimed.map(\.id), [pending.id])
            XCTAssertTrue(try XCTUnwrap(claimed.first).claimed)
            XCTAssertNil(try store.nextReadyAt())

            XCTAssertFalse(try store.cancel(id: pending.id))
            XCTAssertEqual(try store.pendingActions().map(\.id), [pending.id])
        }
    }

    func testCancelRemovesOnlyTheExactUnclaimedOperation() throws {
        try withStore { store, _ in
            let now = Date(timeIntervalSince1970: 2_000)
            try store.enqueue(taskId: "task-1", token: "revision-1", now: now)
            try store.enqueue(taskId: "task-2", token: "revision-2", now: now)
            let pending = try store.pendingActions()

            XCTAssertTrue(try store.cancel(id: pending[0].id, now: now.addingTimeInterval(1)))
            XCTAssertFalse(try store.cancel(id: "missing-operation", now: now.addingTimeInterval(1)))

            XCTAssertEqual(try store.pendingActions().map(\.id), [pending[1].id])
        }
    }

    func testCancelRejectsAnUnclaimedActionAtAndAfterItsDeadline() throws {
        try withStore { store, _ in
            let start = Date(timeIntervalSince1970: 2_500)
            try store.enqueue(taskId: "task-1", token: "revision-1", now: start)
            let action = try XCTUnwrap(store.pendingActions().first)

            XCTAssertFalse(try store.cancel(id: action.id, now: start.addingTimeInterval(3)))
            XCTAssertFalse(try store.cancel(id: action.id, now: start.addingTimeInterval(30)))
            XCTAssertEqual(try store.pendingActions(), [action])
        }
    }

    func testProjectionShowsGraceThenHidesAtTheExactExpiry() throws {
        let start = Date(timeIntervalSince1970: 2_600)
        let action = pendingAction(taskId: "task-1", token: "revision-1", start: start)
        let identity = StrideWidgetActionIdentity(taskId: "task-1", completionToken: "revision-1")

        XCTAssertEqual(
            StrideWidgetActionProjection.pendingAction(
                for: identity,
                in: [action],
                at: start.addingTimeInterval(2.999)
            ),
            action
        )
        XCTAssertFalse(StrideWidgetActionProjection.isHidden(
            identity,
            by: [action],
            at: start.addingTimeInterval(2.999)
        ))
        XCTAssertNil(StrideWidgetActionProjection.pendingAction(
            for: identity,
            in: [action],
            at: start.addingTimeInterval(3)
        ))
        XCTAssertTrue(StrideWidgetActionProjection.isHidden(
            identity,
            by: [action],
            at: start.addingTimeInterval(3)
        ))
    }

    func testProjectionMatchesBothTaskAndCompletionToken() {
        let start = Date(timeIntervalSince1970: 2_700)
        let oldOccurrence = pendingAction(taskId: "recurring", token: "occurrence-1", start: start)
        let nextOccurrence = StrideWidgetActionIdentity(
            taskId: "recurring",
            completionToken: "occurrence-2"
        )

        XCTAssertFalse(StrideWidgetActionProjection.isHidden(
            nextOccurrence,
            by: [oldOccurrence],
            at: start.addingTimeInterval(30)
        ))
        XCTAssertNil(StrideWidgetActionProjection.pendingAction(
            for: nextOccurrence,
            in: [oldOccurrence],
            at: start.addingTimeInterval(1)
        ))
    }

    func testProjectionKeepsFocusPrecedenceAndOnlyFallsBackForDefaultFocus() {
        let now = Date(timeIntervalSince1970: 2_800)
        let focus = StrideWidgetActionIdentity(taskId: "focus-1", completionToken: "focus-token")
        let next = StrideWidgetActionIdentity(taskId: "next-1", completionToken: "next-token")
        let lists: [String: [StrideWidgetActionIdentity]] = [
            "focus": [focus],
            "next": [next],
            "waiting": [],
        ]

        XCTAssertEqual(StrideWidgetActionProjection.resolvedListId(
            requestedListId: "focus",
            identitiesByList: lists,
            pendingActions: [],
            at: now
        ), "focus")

        let expiredFocus = pendingAction(
            taskId: "focus-1",
            token: "focus-token",
            start: now.addingTimeInterval(-3)
        )
        XCTAssertEqual(StrideWidgetActionProjection.resolvedListId(
            requestedListId: "focus",
            identitiesByList: lists,
            pendingActions: [expiredFocus],
            at: now
        ), "next")
        XCTAssertEqual(StrideWidgetActionProjection.resolvedListId(
            requestedListId: "waiting",
            identitiesByList: lists,
            pendingActions: [expiredFocus],
            at: now
        ), "waiting")
        XCTAssertEqual(StrideWidgetActionProjection.resolvedListId(
            requestedListId: "upcoming",
            identitiesByList: lists,
            pendingActions: [],
            at: now
        ), "upcoming")
        XCTAssertEqual(StrideWidgetActionProjection.resolvedListId(
            requestedListId: "focus",
            identitiesByList: ["focus": [], "next": []],
            pendingActions: [],
            at: now
        ), "next")
    }

    func testProjectionRefillsAfterSeveralExpiredCompletions() {
        let now = Date(timeIntervalSince1970: 2_900)
        let identities = (0..<6).map {
            StrideWidgetActionIdentity(taskId: "task-\($0)", completionToken: "token-\($0)")
        }
        let actions = (0..<3).map {
            pendingAction(taskId: "task-\($0)", token: "token-\($0)", start: now.addingTimeInterval(-3))
        }

        XCTAssertEqual(StrideWidgetActionProjection.visibleIndexes(
            in: identities,
            pendingActions: actions,
            at: now
        ), [3, 4, 5])
    }

    func testProjectionSchedulesDistinctFutureExpiryEntries() {
        let now = Date(timeIntervalSince1970: 2_950)
        let first = pendingAction(taskId: "task-1", token: "token-1", start: now)
        let duplicateExpiry = pendingAction(taskId: "task-2", token: "token-2", start: now)
        var claimed = pendingAction(taskId: "task-3", token: "token-3", start: now.addingTimeInterval(1))
        claimed.claimed = true

        XCTAssertEqual(
            StrideWidgetActionProjection.timelineDates(
                pendingActions: [first, duplicateExpiry, claimed],
                now: now
            ),
            [now, now.addingTimeInterval(3)]
        )
    }

    func testLegacyDecodedListsWithoutOpenUriUseCanonicalDestinations() throws {
        struct LegacyList: Decodable {
            let title: String
            let openUri: String?
        }

        let decoded = try JSONDecoder().decode(
            [String: LegacyList].self,
            from: Data(#"""
            {
                "focus":{"title":"Focus"},
                "inbox":{"title":"Inbox"},
                "next":{"title":"Next Actions"},
                "upcoming":{"title":"Upcoming"},
                "waiting":{"title":"Waiting For"},
                "someday":{"title":"Someday/Maybe"},
                "filter:cached":{"title":"Cached filter"}
            }
            """#.utf8)
        )
        let expected = [
            "focus": "stride:///focus",
            "inbox": "stride:///inbox",
            "next": "stride:///widget-list/next",
            "upcoming": "stride:///widget-list/upcoming",
            "waiting": "stride:///waiting",
            "someday": "stride:///someday",
            "filter:cached": "stride:///widget-list/filter%3Acached",
        ]

        for (listId, destination) in expected {
            XCTAssertNil(decoded[listId]?.openUri)
            XCTAssertEqual(
                StrideWidgetListNavigation.destination(
                    for: listId,
                    suppliedOpenUri: decoded[listId]?.openUri
                ),
                destination
            )
        }
        XCTAssertEqual(
            StrideWidgetListNavigation.destination(
                for: "filter:missing-or-deleted",
                suppliedOpenUri: nil
            ),
            "stride:///widget-list/filter%3Amissing-or-deleted"
        )
    }

    func testListNavigationRejectsMismatchedAndUnsafeSuppliedRoutes() {
        XCTAssertEqual(
            StrideWidgetListNavigation.destination(
                for: "inbox",
                suppliedOpenUri: "stride:///waiting"
            ),
            "stride:///inbox"
        )
        XCTAssertEqual(
            StrideWidgetListNavigation.destination(
                for: "filter:chosen",
                suppliedOpenUri: "stride:///widget-list/filter%3Aother"
            ),
            "stride:///widget-list/filter%3Achosen"
        )
        for unsafe in [
            "https://example.com/inbox",
            "stride://evil.example/inbox",
            "stride:///widget-list/filter%3Achosen?override=true",
            "stride:///settings",
        ] {
            XCTAssertEqual(
                StrideWidgetListNavigation.destination(for: "filter:chosen", suppliedOpenUri: unsafe),
                "stride:///widget-list/filter%3Achosen"
            )
        }
        XCTAssertEqual(
            StrideWidgetListNavigation.destination(for: "project:untrusted", suppliedOpenUri: nil),
            "stride:///focus"
        )
        for invalidListId in [
            "filter:",
            "filter:   ",
            "filter:bad\u{0000}id",
            "filter:\(String(repeating: "x", count: 1_025))",
        ] {
            XCTAssertEqual(
                StrideWidgetListNavigation.destination(for: invalidListId, suppliedOpenUri: nil),
                "stride:///focus"
            )
        }
        XCTAssertEqual(
            StrideWidgetListNavigation.destination(for: "filter:f/1 ?+", suppliedOpenUri: nil),
            "stride:///widget-list/filter%3Af%2F1%20%3F%2B"
        )
    }

    func testClaimIsDurableAndReplayableUntilAcknowledged() throws {
        try withStore { store, directory in
            let now = Date(timeIntervalSince1970: 3_000)
            try store.enqueue(taskId: "task-1", token: "revision-1", now: now)
            let firstClaim = try XCTUnwrap(store.claimReady(
                now: now.addingTimeInterval(3)
            ).first)

            let reopened = StrideWidgetActionStore(directory: directory)
            let replay = try reopened.claimReady(now: now.addingTimeInterval(30))
            XCTAssertEqual(replay, [firstClaim])

            try reopened.acknowledge(id: firstClaim.id)
            XCTAssertTrue(try reopened.pendingActions().isEmpty)
            try reopened.acknowledge(id: firstClaim.id)

            try reopened.enqueue(taskId: "task-1", token: "revision-1", now: now)
            XCTAssertTrue(try reopened.pendingActions().isEmpty)
        }
    }

    func testReadOnlyProjectionDoesNotRemoveOrClaimQueuedWorkAcrossRestart() throws {
        try withStore { store, directory in
            let now = Date(timeIntervalSince1970: 3_500)
            try store.enqueue(taskId: "task-1", token: "revision-1", now: now)
            let action = try XCTUnwrap(store.pendingActions().first)
            let identity = StrideWidgetActionIdentity(
                taskId: action.taskId,
                completionToken: action.token
            )

            XCTAssertTrue(StrideWidgetActionProjection.isHidden(
                identity,
                by: [action],
                at: now.addingTimeInterval(3)
            ))

            let reopened = StrideWidgetActionStore(directory: directory)
            XCTAssertEqual(try reopened.pendingActions(), [action])
            XCTAssertFalse(try XCTUnwrap(reopened.pendingActions().first).claimed)
        }
    }

    func testEnqueueReplayIsANoOpBeforeAndAfterClaim() throws {
        try withStore { store, _ in
            let now = Date(timeIntervalSince1970: 4_000)
            try store.enqueue(taskId: "task-1", token: "revision-1", now: now)
            try store.enqueue(taskId: "task-1", token: "revision-1", now: now.addingTimeInterval(1))
            XCTAssertEqual(try store.pendingActions().count, 1)

            _ = try store.claimReady(now: now.addingTimeInterval(3))
            try store.enqueue(taskId: "task-1", token: "revision-1", now: now.addingTimeInterval(4))
            XCTAssertEqual(try store.pendingActions().count, 1)
        }
    }

    func testNextReadyAtIncludesPastUnclaimedTimeAndExcludesClaimedActions() throws {
        try withStore { store, _ in
            let first = Date(timeIntervalSince1970: 4_500)
            let second = first.addingTimeInterval(10)
            try store.enqueue(taskId: "task-1", token: "revision-1", now: first)
            try store.enqueue(taskId: "task-2", token: "revision-2", now: second)

            _ = try store.claimReady(now: first.addingTimeInterval(5))

            XCTAssertEqual(try store.nextReadyAt(), 4_513_000)
            XCTAssertEqual(
                try store.claimReady(now: first.addingTimeInterval(12)).map(\.taskId),
                ["task-1"]
            )
            XCTAssertEqual(try store.nextReadyAt(), 4_513_000)
        }
    }

    func testAcknowledgementRejectsUnclaimedAction() throws {
        try withStore { store, _ in
            try store.enqueue(
                taskId: "task-1",
                token: "revision-1",
                now: Date(timeIntervalSince1970: 5_000)
            )
            let id = try XCTUnwrap(store.pendingActions().first).id

            XCTAssertThrowsError(try store.acknowledge(id: id)) { error in
                XCTAssertEqual(
                    error as? StrideWidgetActionStoreError,
                    .unclaimedAcknowledgement
                )
            }
            XCTAssertEqual(try store.pendingActions().map(\.id), [id])
        }
    }

    func testConcurrentClaimAndCancelReportTheDurableWinner() throws {
        try withStore { store, _ in
            let now = Date(timeIntervalSince1970: 5_500)
            try store.enqueue(taskId: "task-1", token: "revision-1", now: now)
            let id = try XCTUnwrap(store.pendingActions().first).id
            let queue = DispatchQueue(label: "stride-widget-claim-cancel", attributes: .concurrent)
            let ready = DispatchGroup()
            let finished = DispatchGroup()
            let start = DispatchSemaphore(value: 0)
            let cancelResult = LockedValue<Result<Bool, Error>>()
            let claimResult = LockedValue<Result<[StrideWidgetPendingAction], Error>>()

            ready.enter()
            finished.enter()
            queue.async {
                ready.leave()
                start.wait()
                cancelResult.store(Result {
                    try store.cancel(id: id, now: now.addingTimeInterval(2.999))
                })
                finished.leave()
            }

            ready.enter()
            finished.enter()
            queue.async {
                ready.leave()
                start.wait()
                claimResult.store(Result {
                    try store.claimReady(now: now.addingTimeInterval(3))
                })
                finished.leave()
            }

            XCTAssertEqual(ready.wait(timeout: .now() + 5), .success)
            start.signal()
            start.signal()
            XCTAssertEqual(finished.wait(timeout: .now() + 5), .success)

            let didCancel = try XCTUnwrap(cancelResult.load()).get()
            let claimed = try XCTUnwrap(claimResult.load()).get()
            let persisted = try store.pendingActions()
            if didCancel {
                XCTAssertTrue(claimed.isEmpty)
                XCTAssertTrue(persisted.isEmpty)
            } else {
                XCTAssertEqual(claimed.map(\.id), [id])
                XCTAssertEqual(persisted.map(\.id), [id])
                XCTAssertTrue(try XCTUnwrap(persisted.first).claimed)
            }
        }
    }

    func testCorruptStateFailsClosedAndPreservesOriginalBytes() throws {
        try withStore { store, directory in
            let stateURL = directory.appendingPathComponent("stride-widget-actions-v1.json")
            let corrupt = Data("{not-json".utf8)
            try corrupt.write(to: stateURL)

            XCTAssertThrowsError(try store.pendingActions())
            XCTAssertThrowsError(try store.enqueue(taskId: "task-1", token: "revision-1"))
            XCTAssertEqual(try Data(contentsOf: stateURL), corrupt)
        }
    }

    func testPendingCapacityNeverEvictsExistingOperations() throws {
        try withStore { store, _ in
            let now = Date(timeIntervalSince1970: 6_000)
            for index in 0..<StrideWidgetActionStore.maximumPendingActions {
                try store.enqueue(taskId: "task-\(index)", token: "revision-\(index)", now: now)
            }

            XCTAssertThrowsError(
                try store.enqueue(taskId: "overflow", token: "overflow", now: now)
            ) { error in
                XCTAssertEqual(error as? StrideWidgetActionStoreError, .capacityFull)
            }
            XCTAssertEqual(
                try store.pendingActions().count,
                StrideWidgetActionStore.maximumPendingActions
            )
        }
    }

    func testConcurrentStoreInstancesDoNotLoseReadModifyWriteOperations() throws {
        try withStore { firstStore, directory in
            let secondStore = StrideWidgetActionStore(directory: directory)
            let queue = DispatchQueue(label: "stride-widget-action-test", attributes: .concurrent)
            let group = DispatchGroup()
            let errors = LockedErrors()
            let now = Date(timeIntervalSince1970: 7_000)

            for index in 0..<64 {
                group.enter()
                queue.async {
                    defer { group.leave() }
                    do {
                        let store = index.isMultiple(of: 2) ? firstStore : secondStore
                        try store.enqueue(
                            taskId: "task-\(index)",
                            token: "revision-\(index)",
                            now: now
                        )
                    } catch {
                        errors.append(error)
                    }
                }
            }

            XCTAssertEqual(group.wait(timeout: .now() + 10), .success)
            XCTAssertEqual(errors.count, 0)
            XCTAssertEqual(try firstStore.pendingActions().count, 64)
        }
    }

    private func withStore(
        _ body: (StrideWidgetActionStore, URL) throws -> Void
    ) throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("stride-widget-action-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: directory) }
        try body(StrideWidgetActionStore(directory: directory), directory)
    }

    private func pendingAction(
        taskId: String,
        token: String,
        start: Date
    ) -> StrideWidgetPendingAction {
        let createdAt = start.timeIntervalSince1970 * 1_000.0
        return StrideWidgetPendingAction(
            id: "action-\(taskId)-\(token)",
            taskId: taskId,
            token: token,
            createdAt: createdAt,
            notBefore: createdAt + StrideWidgetActionStore.minimumUndoDelayMilliseconds,
            claimed: false
        )
    }
}
