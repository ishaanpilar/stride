// swift-tools-version: 5.10

import PackageDescription

let package = Package(
    name: "StrideWidgetActionStore",
    platforms: [
        .iOS(.v15),
        .macOS(.v13),
    ],
    products: [
        .library(
            name: "StrideWidgetActionStore",
            targets: ["StrideWidgetActionStore"]
        ),
    ],
    targets: [
        .target(
            name: "StrideWidgetActionStore",
            path: "ios",
            exclude: [
                "StrideIosWidget.podspec",
                "StrideIosWidgetModule.swift",
            ],
            sources: ["StrideWidgetActionStore.swift", "StrideWidgetTaskItem.swift"]
        ),
        .testTarget(
            name: "StrideWidgetActionStoreTests",
            dependencies: ["StrideWidgetActionStore"],
            path: "tests"
        ),
    ]
)
