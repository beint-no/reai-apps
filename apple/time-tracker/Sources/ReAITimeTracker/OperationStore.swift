import Foundation

actor OperationStore {
    private let directory = URL.applicationSupportDirectory.appending(path: "ReAI Time Tracker")
    private var file: URL { directory.appending(path: "pending-operation.json") }

    func load() throws -> PendingOperation? {
        guard FileManager.default.fileExists(atPath: file.path) else { return nil }
        return try JSONDecoder().decode(PendingOperation.self, from: Data(contentsOf: file))
    }

    func save(_ operation: PendingOperation) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        try JSONEncoder().encode(operation).write(to: file, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
    }

    func clear() throws {
        if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) }
    }
}
