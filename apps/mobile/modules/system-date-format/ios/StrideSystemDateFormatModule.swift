import ExpoModulesCore
import Foundation

public final class StrideSystemDateFormatModule: Module {
    public func definition() -> ModuleDefinition {
        Name("StrideSystemDateFormat")

        Function("getShortDateFormat") {
            let formatter = DateFormatter()
            formatter.locale = .autoupdatingCurrent
            formatter.calendar = Calendar(identifier: .gregorian)
            formatter.dateStyle = .short
            formatter.timeStyle = .none
            return formatter.dateFormat ?? ""
        }
    }
}
