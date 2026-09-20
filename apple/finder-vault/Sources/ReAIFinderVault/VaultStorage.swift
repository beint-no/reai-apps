import Foundation
import CryptoKit
import Darwin

enum StagingResult: Sendable {
    case staged(Transfer)
    case duplicate(String)
    case ignored
}

actor VaultStorage {
    let root: URL
    private let state: URL
    private var seen: [String: (size: Int, modified: Date?, fingerprint: String)] = [:]

    init(root: URL? = nil, state: URL? = nil) {
        self.root = root ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(VaultEnvironment.vaultFolder, isDirectory: true)
        self.state = state ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent(VaultEnvironment.appName, isDirectory: true).appendingPathComponent("transfers.json")
    }

    func folder(_ company: Company, _ destination: Destination) -> URL {
        root.appendingPathComponent("Company \(company.id)", isDirectory: true)
            .appendingPathComponent(destination.rawValue, isDirectory: true)
    }

    func prepare(_ company: Company) throws -> [URL] {
        try Destination.allCases.map {
            let folder = folder(company, $0).appendingPathComponent("Inbox", isDirectory: true)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            return folder
        }
    }

    func load() throws -> [Transfer] {
        guard FileManager.default.fileExists(atPath: state.path) else { return [] }
        return try JSONDecoder().decode([Transfer].self, from: Data(contentsOf: state)).map {
            var entry = $0
            if entry.status == "Uploading" {
                entry.status = "Check ReAI"
                entry.detail = "The app closed during upload. Check ReAI before retrying to avoid a duplicate."
            }
            return entry
        }
    }

    func save(_ transfers: [Transfer]) throws {
        try FileManager.default.createDirectory(at: state.deletingLastPathComponent(), withIntermediateDirectories: true,
                                               attributes: [.posixPermissions: 0o700])
        try JSONEncoder().encode(transfers).write(to: state, options: .atomic)
    }

    func inboxFiles(_ company: Company) throws -> [(URL, Destination)] {
        try Destination.allCases.flatMap { destination in
            try FileManager.default.contentsOfDirectory(at: folder(company, destination).appendingPathComponent("Inbox"),
                includingPropertiesForKeys: [.isRegularFileKey], options: [.skipsHiddenFiles])
                .map { ($0, destination) }
        }
    }

    func stage(_ source: URL, company: Company, destination: Destination, known: Set<String>) throws -> StagingResult {
        let values = try source.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey, .contentModificationDateKey])
        guard values.isRegularFile == true, values.isSymbolicLink != true else { return .ignored }
        guard let size = values.fileSize, size > 0, size <= 20 * 1024 * 1024 else {
            throw vaultError("\(source.lastPathComponent): files must be between 1 byte and 20 MB.")
        }
        let cacheKey = "\(company.id):\(destination.rawValue):\(source.path)"
        if let cached = seen[cacheKey], cached.size == size,
           cached.modified == values.contentModificationDate, known.contains(cached.fingerprint) { return .duplicate(cached.fingerprint) }
        let input = try FileHandle(forReadingFrom: source)
        defer { try? input.close() }
        let directory = folder(company, destination).appendingPathComponent("Local copies").appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        var retained = false
        defer { if !retained { try? FileManager.default.removeItem(at: directory) } }
        let target = directory.appendingPathComponent(source.lastPathComponent)
        FileManager.default.createFile(atPath: target.path, contents: nil, attributes: [.posixPermissions: 0o600])
        let output = try FileHandle(forWritingTo: target)
        defer { try? output.close() }
        var hash = SHA256()
        var copied = 0
        while let chunk = try input.read(upToCount: 262_144), !chunk.isEmpty {
            copied += chunk.count
            guard copied <= 20 * 1024 * 1024 else { throw vaultError("The file grew beyond 20 MB while copying.") }
            hash.update(data: chunk)
            try output.write(contentsOf: chunk)
        }
        let fingerprint = "\(company.id):\(destination.rawValue):" + hash.finalize().map { String(format: "%02x", $0) }.joined()
        let after = try source.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
        guard copied == size, after.fileSize == size, after.contentModificationDate == values.contentModificationDate else {
            throw vaultError("\(source.lastPathComponent) is still being written. Scan again when the copy finishes.")
        }
        seen[cacheKey] = (size, values.contentModificationDate, fingerprint)
        guard !known.contains(fingerprint) else { return .duplicate(fingerprint) }
        retained = true
        return .staged(Transfer(company: company, destination: destination, filename: source.lastPathComponent,
                        fingerprint: fingerprint, file: target))
    }
}

final class FolderWatcher {
    private var sources: [any DispatchSourceFileSystemObject] = []
    init(urls: [URL], onChange: @escaping @Sendable () -> Void) throws {
        for url in urls {
            let descriptor = open(url.path, O_EVTONLY)
            guard descriptor >= 0 else { throw vaultError("Could not watch \(url.lastPathComponent).") }
            let source = DispatchSource.makeFileSystemObjectSource(fileDescriptor: descriptor,
                eventMask: [.write, .rename, .delete], queue: .global(qos: .utility))
            source.setEventHandler(handler: onChange)
            source.setCancelHandler { close(descriptor) }
            source.resume()
            sources.append(source)
        }
    }
    deinit { sources.forEach { $0.cancel() } }
}
