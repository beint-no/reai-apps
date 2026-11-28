import Foundation
import CryptoKit
import Darwin
import ImageIO
import UniformTypeIdentifiers

enum StagingResult: Sendable {
    case staged(Transfer)
    case duplicate(String)
    case ignored
}

enum AppFolders {
    static var support: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    }
    static var state: URL { support.appendingPathComponent(AppEnvironment.appName, isDirectory: true) }
    static var root: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(AppEnvironment.documentsFolder, isDirectory: true)
    }
}

actor ScannerStorage {
    static let maximumSize = 20 * 1024 * 1024
    let root: URL
    private let state: URL
    private var seen: [String: (size: Int, modified: Date?, fingerprint: String)] = [:]

    init(root: URL? = nil, state: URL? = nil) {
        self.root = root ?? AppFolders.root
        self.state = state ?? AppFolders.state.appendingPathComponent("transfers.json")
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
            if entry.status == TransferStatus.uploading {
                entry.status = TransferStatus.checkReAI
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
                .filter(FileTypes.supported)
                .map { ($0, destination) }
        }
    }

    /// Copies the file into the app's local copies, hashing the original bytes for duplicate detection.
    /// HEIC, TIFF and WebP images are converted to JPEG, which ReAI accepts. The original is never changed.
    func stage(_ source: URL, company: Company, destination: Destination, known: Set<String>) throws -> StagingResult {
        let values = try source.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey, .contentModificationDateKey])
        guard values.isRegularFile == true, values.isSymbolicLink != true else { return .ignored }
        guard FileTypes.supported(source) else {
            throw appError("\(source.lastPathComponent): \(FileTypes.unsupportedMessage)")
        }
        guard let size = values.fileSize, size > 0, size <= Self.maximumSize else {
            throw appError("\(source.lastPathComponent): files must be between 1 byte and 20 MB.")
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
        var target = directory.appendingPathComponent(source.lastPathComponent)
        FileManager.default.createFile(atPath: target.path, contents: nil, attributes: [.posixPermissions: 0o600])
        let output = try FileHandle(forWritingTo: target)
        defer { try? output.close() }
        var hash = SHA256()
        var copied = 0
        while let chunk = try input.read(upToCount: 262_144), !chunk.isEmpty {
            copied += chunk.count
            guard copied <= Self.maximumSize else { throw appError("The file grew beyond 20 MB while copying.") }
            hash.update(data: chunk)
            try output.write(contentsOf: chunk)
        }
        let fingerprint = "\(company.id):\(destination.rawValue):" + hash.finalize().map { String(format: "%02x", $0) }.joined()
        let after = try source.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
        guard copied == size, after.fileSize == size, after.contentModificationDate == values.contentModificationDate else {
            throw appError("\(source.lastPathComponent) is still being written. Scan again when the copy finishes.")
        }
        seen[cacheKey] = (size, values.contentModificationDate, fingerprint)
        guard !known.contains(fingerprint) else { return .duplicate(fingerprint) }
        var filename = source.lastPathComponent
        if FileTypes.converted.contains(source.pathExtension.lowercased()) {
            let jpeg = target.deletingPathExtension().appendingPathExtension("jpg")
            try ImageConversion.jpeg(from: target, to: jpeg)
            try FileManager.default.removeItem(at: target)
            target = jpeg
            filename = jpeg.lastPathComponent
            let converted = try target.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
            guard converted > 0, converted <= Self.maximumSize else { throw appError("\(filename) is larger than 20 MB after conversion.") }
        }
        retained = true
        return .staged(Transfer(company: company, destination: destination, filename: filename,
                        fingerprint: fingerprint, file: target))
    }
}

enum ImageConversion {
    static func jpeg(from source: URL, to target: URL, quality: Double = 0.85) throws {
        guard let image = CGImageSourceCreateWithURL(source as CFURL, nil), CGImageSourceGetCount(image) > 0,
              let output = CGImageDestinationCreateWithURL(target as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else {
            throw appError("\(source.lastPathComponent) could not be read as an image.")
        }
        CGImageDestinationAddImageFromSource(output, image, 0, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
        guard CGImageDestinationFinalize(output) else { throw appError("\(source.lastPathComponent) could not be converted to JPEG.") }
    }
}

final class FolderWatcher {
    private var sources: [any DispatchSourceFileSystemObject] = []
    init(urls: [URL], onChange: @escaping @Sendable () -> Void) throws {
        for url in urls {
            let descriptor = open(url.path, O_EVTONLY)
            guard descriptor >= 0 else { throw appError("Could not watch \(url.lastPathComponent).") }
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
