// swift-tools-version: 5.10

import PackageDescription

let package = Package(
    name: "StrideAppleTaskSearchCollector",
    platforms: [.macOS(.v13)],
    products: [
        .library(
            name: "StrideAppleTaskSearchCollector",
            targets: ["StrideAppleTaskSearchCollector"]
        ),
    ],
    targets: [
        .target(
            name: "StrideAppleTaskSearchCollector",
            path: "ios",
            exclude: [
                "StrideAppleTaskSearch.podspec",
                "StrideAppleTaskSearchModule.swift",
            ],
            sources: ["StrideAppleTaskSearchCollector.swift"]
        ),
        .testTarget(
            name: "StrideAppleTaskSearchCollectorTests",
            dependencies: ["StrideAppleTaskSearchCollector"],
            path: "tests"
        ),
    ]
)
