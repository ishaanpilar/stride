import Foundation

enum StrideWatchReceiptState: String {
    case awaitingAudio
    case audioRetained
    case prepared
    case published
}

enum StrideWatchStageAction: Equatable {
    case create
    case reuse
    case collision
}

enum StrideWatchPreparedRecoveryAction: Equatable {
    case publishStage
    case compactPublishedQueue
    case compactConsumedQueue
    case collision
}


enum StrideWatchReceiptStateMachine {
    static func stageAction(stageExists: Bool, bytesMatch: Bool) -> StrideWatchStageAction {
        guard stageExists else { return .create }
        return bytesMatch ? .reuse : .collision
    }

    static func preparedRecoveryAction(
        stageExists: Bool,
        queueExists: Bool,
        bytesMatch: Bool
    ) -> StrideWatchPreparedRecoveryAction {
        if stageExists {
            return !queueExists && bytesMatch ? .publishStage : .collision
        }
        if queueExists {
            return bytesMatch ? .compactPublishedQueue : .collision
        }


        return .compactConsumedQueue
    }
}
