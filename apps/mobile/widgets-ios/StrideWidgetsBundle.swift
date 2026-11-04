import WidgetKit
import SwiftUI

@main
@MainActor
enum StrideWidgetsEntryPoint {
    static func main() {


        if #available(iOSApplicationExtension 17.0, iOS 17.0, *) {
            StrideWidgetsBundle.main()
        } else {
            StrideLegacyWidgetsBundle.main()
        }
    }
}

@available(iOSApplicationExtension 17.0, iOS 17.0, *)
struct StrideWidgetsBundle: WidgetBundle {
    var body: some Widget {
        StrideTasksWidget()
        StrideCompactWidget()
        StrideFocusLockWidget()
        StrideCaptureLockWidget()
        if #available(iOSApplicationExtension 18.0, iOS 18.0, *) {
            StrideCaptureControl()
        }
    }
}

struct StrideLegacyWidgetsBundle: WidgetBundle {
    var body: some Widget {
        StrideLegacyTasksWidget()
        StrideCompactWidget()

        StrideFocusLockWidget()
        StrideCaptureLockWidget()
    }
}
