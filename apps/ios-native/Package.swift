// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "StrideNativeCore",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [.library(name: "StrideNativeCore", targets: ["StrideNativeCore"])],
    dependencies: [.package(path: "../mobile/modules/attachment-file-installer/ios")],
    targets: [
        .binaryTarget(name: "QuickCryptoOpenSSL",
                      url: "https://github.com/margelo/react-native-quick-crypto/releases/download/openssl-apple-3.6.2/QuickCryptoOpenSSL-3.6.2.zip",
                      checksum: "a50e3c8473b0526b159ad8d105e97a90d1153a4a230388cc731ee23a7d0ad3a4"),
        .target(name: "CStrideArgon2", dependencies: ["QuickCryptoOpenSSL"], publicHeadersPath: "include",
                cSettings: [.headerSearchPath("private")]),
        .target(name: "SQLiteSupport", publicHeadersPath: "include", linkerSettings: [.linkedLibrary("sqlite3")]),
        .target(name: "StrideNativeCore", dependencies: ["SQLiteSupport", "CStrideArgon2", .product(name: "AttachmentFileInstallerEngine", package: "ios")], resources: [.copy("Resources/CryptoNotices.txt")], linkerSettings: [.linkedFramework("JavaScriptCore")]),
        .testTarget(name: "StrideNativeCoreTests", dependencies: ["StrideNativeCore"]),
    ]
)
