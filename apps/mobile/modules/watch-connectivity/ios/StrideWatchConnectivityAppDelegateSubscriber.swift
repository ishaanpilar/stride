import ExpoModulesCore
import UIKit

public final class StrideWatchConnectivityAppDelegateSubscriber: ExpoAppDelegateSubscriber {
    public func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {


        StrideWatchConnectivityReceiver.shared.activateAtLaunch()
        return true
    }
}
