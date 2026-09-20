import Foundation

enum VaultEnvironment {
    static let isLocal = Bundle.main.bundleIdentifier == "no.reai.findervault.local"
    static let origin = isLocal ? "http://localhost:18087" : "https://app.reai.no"
    static let baseURL = URL(string: origin + "/")!
    static let appName = isLocal ? "ReAI Finder Vault Local" : "ReAI Finder Vault"
    static let vaultFolder = isLocal ? "ReAI Vault Local" : "ReAI Vault"
    static let keychainService = isLocal ? "no.reai.findervault.local" : "no.reai.findervault"
    static let profileURL = URL(string: origin + "/user/profile#user-access-tokens")!
}
