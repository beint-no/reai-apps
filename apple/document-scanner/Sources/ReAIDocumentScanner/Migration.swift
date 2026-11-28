import AppKit
import Foundation
import Security

/// Moves an existing ReAI Finder Vault installation into Document Scanner once: transfer history, watched folders,
/// the company inbox folders and the local copies of earlier uploads. Finder Vault's files are renamed, not deleted,
/// so the old app cannot upload the same folders again.
enum FinderVaultMigration {
    static let suffix = ".migrated"
    static var oldState: URL {
        AppFolders.support.appendingPathComponent(AppEnvironment.FinderVault.appName, isDirectory: true)
    }
    static var oldRoot: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(AppEnvironment.FinderVault.folder, isDirectory: true)
    }

    static let doneKey = "finderVaultMigrated"

    /// Finder Vault state that has not been moved yet.
    static var pending: Bool {
        let files = FileManager.default
        return files.fileExists(atPath: oldState.appendingPathComponent("transfers.json").path)
            || files.fileExists(atPath: oldState.appendingPathComponent("watched-folders.json").path)
            || (files.fileExists(atPath: oldRoot.path) && !UserDefaults.standard.bool(forKey: doneKey))
    }

    @MainActor static var oldAppRunning: Bool {
        !NSRunningApplication.runningApplications(withBundleIdentifier: AppEnvironment.FinderVault.bundleID).isEmpty
    }

    /// Moves the state and returns a summary. Nothing is written when Finder Vault's files cannot be read.
    static func run() throws -> String {
        let files = FileManager.default
        let decoder = JSONDecoder()
        let oldTransfers = oldState.appendingPathComponent("transfers.json")
        let oldFolders = oldState.appendingPathComponent("watched-folders.json")
        let newTransfers = AppFolders.state.appendingPathComponent("transfers.json")
        let newFolders = AppFolders.state.appendingPathComponent("watched-folders.json")
        func read<T: Decodable>(_ url: URL) throws -> [T] {
            guard files.fileExists(atPath: url.path) else { return [] }
            do { return try decoder.decode([T].self, from: Data(contentsOf: url)) }
            catch { throw appError("Finder Vault’s \(url.lastPathComponent) could not be read, so nothing was moved. \(error.localizedDescription)") }
        }
        var transfers: [Transfer] = try read(oldTransfers)
        let folders: [WatchedFolder] = try read(oldFolders)
        let existingTransfers: [Transfer] = try read(newTransfers)
        let existingFolders: [WatchedFolder] = try read(newFolders)

        var conflicts = 0
        if files.fileExists(atPath: oldRoot.path) {
            conflicts = try merge(oldRoot, into: AppFolders.root)
        }
        let oldPrefix = oldRoot.standardizedFileURL.path + "/"
        let newRoot = AppFolders.root.standardizedFileURL.path + "/"
        for index in transfers.indices {
            let path = transfers[index].file.standardizedFileURL.path
            guard path.hasPrefix(oldPrefix) else { continue }
            let moved = URL(fileURLWithPath: newRoot + path.dropFirst(oldPrefix.count))
            if files.fileExists(atPath: moved.path) { transfers[index].file = moved }
        }
        try files.createDirectory(at: AppFolders.state, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let knownTransfers = Set(existingTransfers.map(\.id))
        let addedTransfers = transfers.filter { !knownTransfers.contains($0.id) }
        if !addedTransfers.isEmpty {
            try JSONEncoder().encode(addedTransfers + existingTransfers).write(to: newTransfers, options: .atomic)
        }
        let knownPaths = Set(existingFolders.map(\.path))
        let addedFolders = folders.filter { !knownPaths.contains($0.path) }
        if !addedFolders.isEmpty {
            try JSONEncoder().encode(existingFolders + addedFolders).write(to: newFolders, options: .atomic)
        }
        for url in [oldTransfers, oldFolders] where files.fileExists(atPath: url.path) {
            let renamed = URL(fileURLWithPath: url.path + suffix)
            try? files.removeItem(at: renamed)
            try files.moveItem(at: url, to: renamed)
        }
        UserDefaults.standard.set(true, forKey: doneKey)
        func count(_ value: Int, _ noun: String) -> String { "\(value) \(noun)\(value == 1 ? "" : "s")" }
        var summary = "Moved \(count(addedTransfers.count, "upload")) and \(count(addedFolders.count, "watched folder")) from ReAI Finder Vault."
        if conflicts > 0 {
            summary += " \(conflicts) files with the same name were left in ~/\(AppEnvironment.FinderVault.folder)."
        }
        return summary
    }

    /// Moves `source` into `target`, merging folders. Files that already exist in the target stay where they are.
    private static func merge(_ source: URL, into target: URL) throws -> Int {
        let files = FileManager.default
        guard files.fileExists(atPath: target.path) else {
            try files.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
            try files.moveItem(at: source, to: target)
            return 0
        }
        var isDirectory: ObjCBool = false
        guard files.fileExists(atPath: target.path, isDirectory: &isDirectory), isDirectory.boolValue,
              (try source.resourceValues(forKeys: [.isDirectoryKey])).isDirectory == true else {
            if source.lastPathComponent == ".DS_Store" { try? files.removeItem(at: source); return 0 }
            return 1
        }
        var conflicts = 0
        for child in try files.contentsOfDirectory(at: source, includingPropertiesForKeys: [.isDirectoryKey]) {
            conflicts += try merge(child, into: target.appendingPathComponent(child.lastPathComponent))
        }
        if (try? files.contentsOfDirectory(atPath: source.path))?.isEmpty == true { try? files.removeItem(at: source) }
        return conflicts
    }

    enum Connection: Sendable {
        case token(String)
        case missing
        case unreadable
    }

    /// Reads Finder Vault's Keychain item. macOS may ask the user to allow access, because the item belongs to the old app.
    static func connection() -> Connection {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: AppEnvironment.FinderVault.keychainService,
            kSecAttrAccount as String: "access-token", kSecReturnData as String: true]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return .missing }
        guard status == errSecSuccess, let data = result as? Data, let token = String(data: data, encoding: .utf8),
              !token.isEmpty else { return .unreadable }
        return .token(token)
    }
}
