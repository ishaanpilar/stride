import SwiftUI

@main
struct StrideWatchApp: App {
    @StateObject private var model = StrideWatchConnectivityModel.shared

    var body: some Scene {
        WindowGroup {
            StrideWatchRootView()
                .environmentObject(model)
        }
    }
}
