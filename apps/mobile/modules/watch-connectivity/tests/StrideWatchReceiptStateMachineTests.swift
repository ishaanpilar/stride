import XCTest
@testable import StrideWatchPayloadValidation

final class StrideWatchReceiptStateMachineTests: XCTestCase {
    func testOrphanStageIsReusedOnlyForTheSamePayload() {
        XCTAssertEqual(
            StrideWatchReceiptStateMachine.stageAction(
                stageExists: false,
                bytesMatch: false
            ),
            .create
        )
        XCTAssertEqual(
            StrideWatchReceiptStateMachine.stageAction(
                stageExists: true,
                bytesMatch: true
            ),
            .reuse
        )
        XCTAssertEqual(
            StrideWatchReceiptStateMachine.stageAction(
                stageExists: true,
                bytesMatch: false
            ),
            .collision
        )
    }

    func testPreparedReceiptPublishesItsDurableStageExactlyOnce() {
        XCTAssertEqual(
            StrideWatchReceiptStateMachine.preparedRecoveryAction(
                stageExists: true,
                queueExists: false,
                bytesMatch: true
            ),
            .publishStage
        )
    }

    func testPreparedReceiptCompactsAfterPublishedQueueSurvivesCrash() {
        XCTAssertEqual(
            StrideWatchReceiptStateMachine.preparedRecoveryAction(
                stageExists: false,
                queueExists: true,
                bytesMatch: true
            ),
            .compactPublishedQueue
        )
    }

    func testPreparedReceiptNeverRecreatesQueueConsumedBeforeCrash() {
        XCTAssertEqual(
            StrideWatchReceiptStateMachine.preparedRecoveryAction(
                stageExists: false,
                queueExists: false,
                bytesMatch: false
            ),
            .compactConsumedQueue
        )
    }

    func testPreparedReceiptFailsClosedOnCollisionOrCorruption() {
        XCTAssertEqual(
            StrideWatchReceiptStateMachine.preparedRecoveryAction(
                stageExists: true,
                queueExists: true,
                bytesMatch: true
            ),
            .collision
        )
        XCTAssertEqual(
            StrideWatchReceiptStateMachine.preparedRecoveryAction(
                stageExists: true,
                queueExists: false,
                bytesMatch: false
            ),
            .collision
        )
        XCTAssertEqual(
            StrideWatchReceiptStateMachine.preparedRecoveryAction(
                stageExists: false,
                queueExists: true,
                bytesMatch: false
            ),
            .collision
        )
    }
}
