// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "StrideGmailAuthorizationCore",
    platforms: [.macOS(.v13), .iOS(.v15)],
    products: [.library(name: "StrideGmailAuthorizationCore", targets: ["StrideGmailAuthorizationCore"])],
    targets: [
        .target(name: "StrideGmailAuthorizationCore", path: ".", exclude: ["Tests", "StrideGmailAuthorizationModule.swift", "GmailWebAuthenticationBrowser.swift"],
                sources: ["GmailAuthorizationCore.swift", "GmailBoundedHTTPTransport.swift"]),
        .testTarget(name: "StrideGmailAuthorizationCoreTests", dependencies: ["StrideGmailAuthorizationCore"], path: "Tests")
    ])
