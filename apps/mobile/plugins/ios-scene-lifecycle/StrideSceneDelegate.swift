import UIKit

private enum StrideSceneDeliveryKind: String {
    case none
    case url
    case userActivity
    case shortcut
    case notification
}

public final class StrideSceneDelegate: UIResponder, UIWindowSceneDelegate {
    public var window: UIWindow?

    private let quickActionTypeToURL: [String: String] = [
        "com.ishaanpilar.stride.add_task": "stride:///capture-quick?mode=text",
        "com.ishaanpilar.stride.open_focus": "stride:///focus",
        "com.ishaanpilar.stride.open_calendar": "stride:///calendar",
    ]

    public func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        guard let windowScene = scene as? UIWindowScene else { return }
        guard let appDelegate = UIApplication.shared.delegate as? AppDelegate else {
            assertionFailure("StrideSceneDelegate requires the generated AppDelegate")
            return
        }


        let sceneWindow = appDelegate.window ?? UIWindow()
        sceneWindow.windowScene = windowScene
        sceneWindow.frame = windowScene.coordinateSpace.bounds
        window = sceneWindow

        if appDelegate.strideHasStartedReactNative {
            appDelegate.strideRecordSceneDiagnostic(
                stage: "sceneConnected",
                deliveryKind: StrideSceneDeliveryKind.none.rawValue
            )
            appDelegate.strideStartReactNative(
                in: sceneWindow,
                launchOptions: appDelegate.strideLaunchOptionsForScene()
            )
            forwardReconnectDeliveries(connectionOptions, appDelegate: appDelegate)
            return
        }

        var launchOptions = appDelegate.strideLaunchOptionsForScene()
        let deliveryKind = prepareColdDelivery(
            connectionOptions,
            launchOptions: &launchOptions,
            appDelegate: appDelegate
        )
        appDelegate.strideRecordSceneDiagnostic(
            stage: "sceneConnected",
            deliveryKind: deliveryKind.rawValue
        )
        appDelegate.strideStartReactNative(
            in: sceneWindow,
            launchOptions: launchOptions
        )
        appDelegate.strideRecordSceneDiagnostic(
            stage: "rootStarted",
            deliveryKind: deliveryKind.rawValue
        )
        if deliveryKind != .none {
            appDelegate.strideRecordSceneDiagnostic(
                stage: "coldDelivery",
                deliveryKind: deliveryKind.rawValue
            )
        }
    }

    public func scene(
        _ scene: UIScene,
        openURLContexts URLContexts: Set<UIOpenURLContext>
    ) {
        guard let appDelegate = UIApplication.shared.delegate as? AppDelegate else { return }


        for context in URLContexts {
            _ = appDelegate.strideForwardWarmURL(
                context.url,
                options: openOptions(for: context)
            )
            appDelegate.strideRecordSceneDiagnostic(
                stage: "warmDelivery",
                deliveryKind: StrideSceneDeliveryKind.url.rawValue
            )
        }
    }

    public func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        guard let appDelegate = UIApplication.shared.delegate as? AppDelegate else { return }
        _ = appDelegate.strideForwardWarmUserActivity(userActivity)
        appDelegate.strideRecordSceneDiagnostic(
            stage: "warmDelivery",
            deliveryKind: StrideSceneDeliveryKind.userActivity.rawValue
        )
    }

    public func windowScene(
        _ windowScene: UIWindowScene,
        performActionFor shortcutItem: UIApplicationShortcutItem,
        completionHandler: @escaping (Bool) -> Void
    ) {
        guard let appDelegate = UIApplication.shared.delegate as? AppDelegate,
              let destinationURL = quickActionURL(shortcutItem) else {
            completionHandler(false)
            return
        }
        let handled = appDelegate.strideForwardWarmURL(destinationURL, options: [:])
        appDelegate.strideRecordSceneDiagnostic(
            stage: "warmDelivery",
            deliveryKind: StrideSceneDeliveryKind.shortcut.rawValue
        )
        completionHandler(handled)
    }

    public func sceneDidBecomeActive(_ scene: UIScene) {
        guard let appDelegate = UIApplication.shared.delegate as? AppDelegate else { return }
        appDelegate.strideSceneDidBecomeActive()
        appDelegate.strideRecordSceneDiagnostic(stage: "didBecomeActive", deliveryKind: "none")
    }

    public func sceneWillResignActive(_ scene: UIScene) {
        guard let appDelegate = UIApplication.shared.delegate as? AppDelegate else { return }
        appDelegate.strideSceneWillResignActive()
        appDelegate.strideRecordSceneDiagnostic(stage: "willResignActive", deliveryKind: "none")
    }

    public func sceneDidEnterBackground(_ scene: UIScene) {
        guard let appDelegate = UIApplication.shared.delegate as? AppDelegate else { return }
        appDelegate.strideSceneDidEnterBackground()
        appDelegate.strideRecordSceneDiagnostic(stage: "didEnterBackground", deliveryKind: "none")
    }

    public func sceneWillEnterForeground(_ scene: UIScene) {
        guard let appDelegate = UIApplication.shared.delegate as? AppDelegate else { return }
        appDelegate.strideSceneWillEnterForeground()
        appDelegate.strideRecordSceneDiagnostic(stage: "willEnterForeground", deliveryKind: "none")
    }

    private func prepareColdDelivery(
        _ connectionOptions: UIScene.ConnectionOptions,
        launchOptions: inout [UIApplication.LaunchOptionsKey: Any],
        appDelegate: AppDelegate
    ) -> StrideSceneDeliveryKind {
        if let response = connectionOptions.notificationResponse {


            RnAlarmNotification.didReceive(
                response,
                cacheForColdStart: true
            )
            return .notification
        }

        if let shortcutItem = connectionOptions.shortcutItem,
           let destinationURL = quickActionURL(shortcutItem) {
            launchOptions[.shortcutItem] = shortcutItem
            launchOptions[.url] = destinationURL
            appDelegate.strideSeedColdURL(destinationURL, options: [:])
            return .shortcut
        }

        if let context = connectionOptions.urlContexts.first {
            let options = openOptions(for: context)
            launchOptions[.url] = context.url
            for (key, value) in options {
                launchOptions[UIApplication.LaunchOptionsKey(rawValue: key.rawValue)] = value
            }
            appDelegate.strideSeedColdURL(context.url, options: options)
            return .url
        }

        if let userActivity = connectionOptions.userActivities.first {
            launchOptions[.userActivityDictionary] = [
                "UIApplicationLaunchOptionsUserActivityTypeKey": userActivity.activityType,
                "UIApplicationLaunchOptionsUserActivityKey": userActivity,
            ]
            appDelegate.strideSeedColdUserActivity(userActivity)
            return .userActivity
        }

        return .none
    }

    private func forwardReconnectDeliveries(
        _ connectionOptions: UIScene.ConnectionOptions,
        appDelegate: AppDelegate
    ) {
        if let response = connectionOptions.notificationResponse {


            RnAlarmNotification.didReceive(response)
            appDelegate.strideRecordSceneDiagnostic(
                stage: "warmDelivery",
                deliveryKind: StrideSceneDeliveryKind.notification.rawValue
            )
        }
        for context in connectionOptions.urlContexts {
            _ = appDelegate.strideForwardWarmURL(
                context.url,
                options: openOptions(for: context)
            )
            appDelegate.strideRecordSceneDiagnostic(
                stage: "warmDelivery",
                deliveryKind: StrideSceneDeliveryKind.url.rawValue
            )
        }
        for userActivity in connectionOptions.userActivities {
            _ = appDelegate.strideForwardWarmUserActivity(userActivity)
            appDelegate.strideRecordSceneDiagnostic(
                stage: "warmDelivery",
                deliveryKind: StrideSceneDeliveryKind.userActivity.rawValue
            )
        }
        if let shortcutItem = connectionOptions.shortcutItem,
           let destinationURL = quickActionURL(shortcutItem) {
            _ = appDelegate.strideForwardWarmURL(destinationURL, options: [:])
            appDelegate.strideRecordSceneDiagnostic(
                stage: "warmDelivery",
                deliveryKind: StrideSceneDeliveryKind.shortcut.rawValue
            )
        }
    }

    private func openOptions(
        for context: UIOpenURLContext
    ) -> [UIApplication.OpenURLOptionsKey: Any] {
        var options: [UIApplication.OpenURLOptionsKey: Any] = [
            .openInPlace: context.options.openInPlace,
        ]

        if let annotation = context.options.annotation {
            options[.annotation] = annotation
        }
        if let sourceApplication = context.options.sourceApplication {
            options[.sourceApplication] = sourceApplication
        }
        return options
    }

    private func quickActionURL(_ shortcutItem: UIApplicationShortcutItem) -> URL? {
        if let rawURL = shortcutItem.userInfo?["url"] as? String,
           let parsedURL = URL(string: rawURL) {
            return parsedURL
        }
        guard let mappedURL = quickActionTypeToURL[shortcutItem.type] else { return nil }
        return URL(string: mappedURL)
    }
}
