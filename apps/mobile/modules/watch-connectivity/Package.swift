// swift-tools-version: 5.10

import PackageDescription

let package = Package(
    name: "StrideWatchPayloadValidation",
    platforms: [
        .iOS(.v15),
        .macOS(.v13),
    ],
    products: [
        .library(
            name: "StrideWatchPayloadValidation",
            targets: ["StrideWatchPayloadValidation"]
        ),
    ],
    targets: [
        .target(
            name: "StrideWatchPayloadValidation",
            path: "ios",
            exclude: [
                "StrideWatchConnectivity.podspec",
                "StrideWatchConnectivityAppDelegateSubscriber.swift",
                "StrideWatchConnectivityModule.swift",
                "StrideWatchConnectivityReceiver.swift",
            ],
            sources: [
                "StrideCanonicalWave.swift",
                "StrideWatchAudioPathResolver.swift",
                "StrideWatchPayloadValidator.swift",
                "StrideWatchReceiptStateMachine.swift",
            ]
        ),
        .testTarget(
            name: "StrideWatchPayloadValidationTests",
            dependencies: ["StrideWatchPayloadValidation"],
            path: "tests"
        ),
    ]
)
