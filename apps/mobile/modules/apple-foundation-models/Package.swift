// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "StrideAppleFoundationModelsNativeTests",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "AppleClarificationRequestRegistry", targets: ["AppleClarificationRequestRegistry"]),
    ],
    targets: [
        .target(
            name: "AppleClarificationRequestRegistry",
            path: "ios",
            exclude: ["StrideAppleFoundationModelsModule.swift", "StrideAppleFoundationModels.podspec"]
        ),
        .testTarget(
            name: "AppleClarificationRequestRegistryTests",
            dependencies: ["AppleClarificationRequestRegistry"],
            path: "Tests"
        ),
    ]
)
