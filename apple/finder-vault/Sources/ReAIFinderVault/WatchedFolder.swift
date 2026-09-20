import Foundation

struct FileStamp: Codable, Equatable, Sendable {
    let size: Int
    let modified: Date?
}

struct WatchedFolder: Codable, Identifiable, Sendable {
    var id = UUID()
    let company: Company
    let destination: Destination
    let accountEmail: String
    var bookmark: Data
    var path: String
    var enabled = true
    var knownFiles: [String: FileStamp]
}

actor WatchedFolderStorage {
    private let state: URL

    init(state: URL? = nil) {
        self.state = state ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent(VaultEnvironment.appName).appendingPathComponent("watched-folders.json")
    }

    func load() throws -> [WatchedFolder] {
        guard FileManager.default.fileExists(atPath: state.path) else { return [] }
        return try JSONDecoder().decode([WatchedFolder].self, from: Data(contentsOf: state))
    }

    func save(_ folders: [WatchedFolder]) throws {
        try FileManager.default.createDirectory(at: state.deletingLastPathComponent(), withIntermediateDirectories: true,
                                               attributes: [.posixPermissions: 0o700])
        try JSONEncoder().encode(folders).write(to: state, options: .atomic)
    }

    func snapshot(_ folder: URL) throws -> [String: FileStamp] {
        var result: [String: FileStamp] = [:]
        for file in try FileManager.default.contentsOfDirectory(at: folder,
            includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey, .contentModificationDateKey],
            options: [.skipsHiddenFiles]) {
            let values = try file.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey, .contentModificationDateKey])
            guard values.isRegularFile == true, values.isSymbolicLink != true,
                  !["part", "partial", "download", "crdownload", "tmp"].contains(file.pathExtension.lowercased()) else { continue }
            result[file.lastPathComponent] = FileStamp(size: values.fileSize ?? 0, modified: values.contentModificationDate)
        }
        return result
    }
}
