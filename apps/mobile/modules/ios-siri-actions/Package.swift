// swift-tools-version: 5.10

import PackageDescription

let package = Package(
    name: "StrideSiriActionStore",
    platforms: [
        .iOS(.v15),
        .macOS(.v13),
    ],
    products: [
        .library(
            name: "StrideSiriActionStore",
            targets: ["StrideSiriActionStore"]
        ),
    ],
    targets: [
        .target(
            name: "StrideSiriActionStore",
            path: "ios",
            exclude: [
                "StrideIosSiriActions.podspec",
                "StrideIosSiriActionsModule.swift",
            ],
            sources: ["StrideSiriActionStore.swift"]
        ),
        .testTarget(
            name: "StrideSiriActionStoreTests",
            dependencies: ["StrideSiriActionStore"],
            path: "tests"
        ),
    ]
)
