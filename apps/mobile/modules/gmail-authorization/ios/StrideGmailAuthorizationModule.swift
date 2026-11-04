import ExpoModulesCore
import Foundation

@MainActor
private enum GmailNativeClient {
    static let shared = GmailAuthorizationClient(
        configuration: GmailAuthorizationConfiguration(
            clientId: Bundle.main.object(forInfoDictionaryKey: "StrideGmailClientId") as? String,
            enabled: Bundle.main.object(forInfoDictionaryKey: "StrideGmailEnabled") as? Bool == true),
        vault: GmailKeychainVault(service: "\(Bundle.main.bundleIdentifier ?? "Stride").gmail-authorization"),
        http: GmailBoundedHTTPTransport(), browser: GmailWebAuthenticationBrowser())
}

public final class StrideGmailAuthorizationModule: Module {
    public func definition() -> ModuleDefinition {
        Name("StrideGmailAuthorization")
        AsyncFunction("status") { () async throws -> [String: Any] in
            try await self.sanitized { try await GmailNativeClient.shared.status() }
        }
        AsyncFunction("connect") { () async throws -> [String: Any] in
            try await self.sanitized { try await GmailNativeClient.shared.connect() }
        }
        AsyncFunction("cancel") { () async -> Void in
            await GmailNativeClient.shared.cancel()
        }
        AsyncFunction("disconnect") { () async throws -> [String: Any] in
            try await self.sanitized { try await GmailNativeClient.shared.disconnect() }
        }
        AsyncFunction("get") { (path: String) async throws -> [String: Any] in
            try await self.sanitized { try await GmailNativeClient.shared.get(path) }
        }
    }

    private func sanitized<T>(_ operation: () async throws -> T) async throws -> T {
        do { return try await operation() }
        catch {
            let failure = error as? GmailAuthorizationFailure ?? .other
            throw Exception(name: "GmailAuthorizationException", description: failure.message, code: failure.rawValue)
        }
    }
}
