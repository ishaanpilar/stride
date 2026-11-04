import ExpoModulesCore
import Foundation
import WidgetKit

public final class StrideIosWidgetModule: Module {
    public func definition() -> ModuleDefinition {
        Name("StrideIosWidget")

        AsyncFunction("claimPendingCompletions") { () throws -> [[String: Any]] in
            let actions = try StrideWidgetActionStore.appGroupStore().claimReady()
            return actions.map { action in
                [
                    "id": action.id,
                    "taskId": action.taskId,
                    "token": action.token,
                    "createdAt": action.createdAt,
                    "notBefore": action.notBefore,
                    "claimed": action.claimed,
                ]
            }
        }

        AsyncFunction("acknowledgePendingCompletion") { (id: String) throws -> Void in
            try StrideWidgetActionStore.appGroupStore().acknowledge(id: id)
            WidgetCenter.shared.reloadTimelines(ofKind: "StrideTasksWidget")
        }

        AsyncFunction("getNextPendingCompletionAt") { () throws -> Double? in
            try StrideWidgetActionStore.appGroupStore().nextReadyAt()
        }
    }
}
