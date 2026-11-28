import Foundation

enum AppEnvironment {
    static let isLocal = Bundle.main.bundleIdentifier == "no.reai.documentscanner.local"
    static let origin = isLocal ? "http://localhost:18087" : "https://app.reai.no"
    static let baseURL = URL(string: origin + "/")!
    static let appName = isLocal ? "ReAI Document Scanner Local" : "ReAI Document Scanner"
    /// Home folder with the company inbox folders and local copies of every upload.
    static let documentsFolder = isLocal ? "ReAI Document Scanner Local" : "ReAI Document Scanner"
    static let keychainService = isLocal ? "no.reai.documentscanner.local" : "no.reai.documentscanner"
    static let clientID = "document-scanner"
    static let clientName = "ReAI Document Scanner"
    static let profileURL = URL(string: origin + "/user/profile#user-access-tokens")!

    /// The app this one replaces. Its local state and connection are moved over once.
    enum FinderVault {
        static let bundleID = isLocal ? "no.reai.findervault.local" : "no.reai.findervault"
        static let appName = isLocal ? "ReAI Finder Vault Local" : "ReAI Finder Vault"
        static let folder = isLocal ? "ReAI Vault Local" : "ReAI Vault"
        static let keychainService = isLocal ? "no.reai.findervault.local" : "no.reai.findervault"
    }
}
