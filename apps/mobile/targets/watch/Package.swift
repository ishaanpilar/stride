// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "StrideWatchCaptureState",
    products: [
        .library(name: "StrideWatchCaptureState", targets: ["StrideWatchCaptureState"]),
    ],
    targets: [
        .target(
            name: "StrideWatchCaptureState",
            path: "App",
            exclude: [
                "StrideWatchApp.swift",
                "StrideWatchIntents.swift",
                "StrideWatchViews.swift",
                "WatchAudioRecorder.swift",
                "WatchConnectivityModel.swift",
            ],
            sources: ["WatchOutbox.swift"]
        ),
        .target(
            name: "StrideWatchProtocolCore",
            path: "Shared",
            exclude: ["WatchSnapshotStore.swift"],
            sources: ["WatchProtocol.swift"]
        ),
        .testTarget(
            name: "StrideWatchCaptureStateTests",
            dependencies: ["StrideWatchCaptureState", "StrideWatchProtocolCore"],
            path: "Tests"
        ),
    ]
)
